from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from app.core import auth
from app.core.db import User

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class Me(BaseModel):
    username: str


def current_user(request: Request) -> User:
    user = auth.user_from_token(request.cookies.get(auth.SESSION_COOKIE))
    if user is None:
        raise HTTPException(401, "로그인이 필요합니다.")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


@router.post("/login", response_model=Me)
def login(body: LoginRequest, response: Response) -> Me:
    token = auth.login(body.username.strip(), body.password)
    if token is None:
        raise HTTPException(401, "아이디 또는 비밀번호가 맞지 않습니다.")
    response.set_cookie(
        auth.SESSION_COOKIE, token, max_age=auth.SESSION_DAYS * 86400, httponly=True, samesite="lax", path="/"
    )
    return Me(username=body.username.strip())


@router.post("/logout")
def logout(request: Request, response: Response) -> dict[str, bool]:
    auth.logout(request.cookies.get(auth.SESSION_COOKIE))
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me", response_model=Me)
def me(user: CurrentUser) -> Me:
    return Me(username=user.username)
