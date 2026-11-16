"""SQLite DB (data/app.db). 사용자·로그인 세션·실행을 저장한다.

실행의 진행 상태(RunState)는 구조가 깊어서 표로 나누지 않고 runs.state에 JSON 그대로 넣는다.
생성된 이미지·복사한 제품 사진·html_input.json 같은 파일은 계속 data/runs/{run_id}/ 폴더에 둔다.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime

from sqlalchemy import ForeignKey, String, Text, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)


class LoginSession(Base):
    __tablename__ = "sessions"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime]


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    # 목록 화면용으로 state에서 꺼내 둔 값
    persona: Mapped[str] = mapped_column(Text)
    product_name: Mapped[str] = mapped_column(String(200))
    state: Mapped[str] = mapped_column(Text)  # RunState JSON
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime] = mapped_column(index=True)


settings.db_path.parent.mkdir(parents=True, exist_ok=True)
engine = create_engine(f"sqlite:///{settings.db_path}", connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_connection, _record) -> None:
    # 이미지 생성 중 저장과 화면의 주기적 읽기가 겹쳐도 읽기가 막히지 않게 WAL을 쓴다
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(engine, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(engine)


@contextmanager
def session_scope() -> Iterator[Session]:
    with SessionLocal() as session, session.begin():
        yield session
