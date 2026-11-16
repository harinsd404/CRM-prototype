"""아이디·비밀번호 로그인. 회원가입 화면은 없고 scripts/add_user.py로 계정을 넣는다. 역할 구분은 없다."""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from sqlalchemy import delete, select

from app.core.db import LoginSession, User, session_scope

SESSION_COOKIE = "crm_session"
SESSION_DAYS = 14
_SCRYPT = {"n": 2**14, "r": 8, "p": 1}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt, digest = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), **_SCRYPT)
    return hmac.compare_digest(actual.hex(), digest)


def set_user(username: str, password: str) -> bool:
    """계정을 만들거나 비밀번호를 바꾼다. 새로 만들었으면 True."""
    with session_scope() as db:
        user = db.scalar(select(User).where(User.username == username))
        if user:
            user.password_hash = hash_password(password)
            return False
        db.add(User(username=username, password_hash=hash_password(password)))
        return True


def login(username: str, password: str) -> str | None:
    """맞으면 새 세션 토큰을 돌려준다."""
    with session_scope() as db:
        user = db.scalar(select(User).where(User.username == username))
        if user is None or not verify_password(password, user.password_hash):
            return None
        token = secrets.token_urlsafe(32)
        db.add(LoginSession(token=token, user_id=user.id, expires_at=datetime.now() + timedelta(days=SESSION_DAYS)))
        db.execute(delete(LoginSession).where(LoginSession.expires_at < datetime.now()))
        return token


def user_from_token(token: str | None) -> User | None:
    if not token:
        return None
    with session_scope() as db:
        session = db.get(LoginSession, token)
        if session is None or session.expires_at < datetime.now():
            return None
        return db.get(User, session.user_id)


def logout(token: str | None) -> None:
    if token:
        with session_scope() as db:
            db.execute(delete(LoginSession).where(LoginSession.token == token))
