"""SQLite DB (data/app.db). 사용자·로그인 세션·제품 템플릿·실행을 저장한다.

실행의 진행 상태(RunState)는 구조가 깊어서 표로 나누지 않고 runs.state에 JSON 그대로 넣는다.
생성된 이미지·복사한 제품 사진·html_input.json 같은 파일은 계속 data/runs/{run_id}/ 폴더에 둔다.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

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


class Template(Base):
    """제품 하나의 템플릿 (예: Galaxy Z Fold). 모든 사용자가 함께 쓴다."""

    __tablename__ = "templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    product_name: Mapped[str] = mapped_column(String(200))
    colors: Mapped[str] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.now)

    pods: Mapped[list["TemplatePod"]] = relationship(
        order_by="TemplatePod.position", cascade="all, delete-orphan", lazy="selectin"
    )
    images: Mapped[list["TemplateImage"]] = relationship(
        order_by="TemplateImage.position", cascade="all, delete-orphan", lazy="selectin"
    )


class TemplatePod(Base):
    """템플릿의 Pod. position = 기본 순서, enabled = 새 실행에서 기본으로 켜 둘지."""

    __tablename__ = "template_pods"
    __table_args__ = (UniqueConstraint("template_id", "name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("templates.id", ondelete="CASCADE"), index=True)
    position: Mapped[int]
    name: Mapped[str] = mapped_column(String(30))
    key: Mapped[str] = mapped_column(String(30))
    spec: Mapped[str] = mapped_column(Text, default="")
    visual: Mapped[str] = mapped_column(Text, default="")
    enabled: Mapped[bool] = mapped_column(default=True)


class TemplateImage(Base):
    """템플릿의 기본 이미지 (이미지 생성에 쓰는 공식 제품 사진). 파일은 data/uploads/{file}에 있다.
    role = 사진 자리(closed_front 등) 또는 'extra'(추가 사진, position 순서)."""

    __tablename__ = "template_images"

    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("templates.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(30))
    file: Mapped[str] = mapped_column(String(64))
    position: Mapped[int] = mapped_column(default=0)


class ProfileVersion(Base):
    """템플릿의 제품 프로필(프롬프트의 제품별 블록) 버전. active가 지금 쓰는 것, archived는 예전 것(되돌리기용),
    proposed는 피드백을 보고 AI가 낸 개선안(승인 전), rejected는 거절한 개선안.
    source: seed / ai(제품 사진으로 생성) / manual(고급 모드에서 고침) / feedback(피드백 개선안) / run(실행을 템플릿으로 저장)."""

    __tablename__ = "profile_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("templates.id", ondelete="CASCADE"), index=True)
    version: Mapped[int]
    profile: Mapped[str] = mapped_column(Text)  # ProductProfile JSON
    status: Mapped[str] = mapped_column(String(10), default="active")
    source: Mapped[str] = mapped_column(String(10), default="manual")
    note: Mapped[str] = mapped_column(Text, default="")  # 무엇을 왜 바꿨는지
    feedback_ids: Mapped[str] = mapped_column(Text, default="")  # 개선안이 반영한 피드백 id (쉼표 구분)
    base_version: Mapped[int | None]  # 개선안을 만들 때 쓰던 active 버전 (승인할 때 그 사이 바뀌었는지 본다)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    template_id: Mapped[int | None] = mapped_column(ForeignKey("templates.id", ondelete="SET NULL"))
    # 목록 화면용으로 state에서 꺼내 둔 값
    persona: Mapped[str] = mapped_column(Text)
    product_name: Mapped[str] = mapped_column(String(200))
    state: Mapped[str] = mapped_column(Text)  # RunState JSON
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime] = mapped_column(index=True)


class Feedback(Base):
    """사용자가 만든 CRM에서 마음에 들지 않는 부분. 템플릿별로 모아 프롬프트 개선(직접 수정·AI 개선안)과
    개발자의 로직 개선에 쓴다. source: manual(직접 남김) / regenerate(다시 생성 요청) / revise(수정 요청)."""

    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int | None] = mapped_column(ForeignKey("templates.id", ondelete="SET NULL"), index=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    step: Mapped[str] = mapped_column(String(10))  # pod / copy / image / result(최종 시안)
    pod: Mapped[str | None] = mapped_column(String(30))
    content: Mapped[str] = mapped_column(Text)
    context: Mapped[str] = mapped_column(Text, default="")  # 피드백을 남길 때 선택돼 있던 결과 (코드가 채움)
    source: Mapped[str] = mapped_column(String(10), default="manual")
    status: Mapped[str] = mapped_column(String(10), default="open")  # open / applied / dismissed
    created_at: Mapped[datetime] = mapped_column(default=datetime.now, index=True)


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
    _add_missing_columns()
    from app.core.templates import seed_templates  # 순환 import 방지

    seed_templates()


def _add_missing_columns() -> None:
    """create_all은 이미 있는 테이블에 칸을 더하지 않는다. 마이그레이션 도구 없이 나중에 생긴 칸만 더한다."""
    with engine.begin() as conn:
        columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(runs)")}
        if "template_id" not in columns:
            conn.exec_driver_sql("ALTER TABLE runs ADD COLUMN template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL")
        columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(profile_versions)")}
        if columns and "feedback_ids" not in columns:
            conn.exec_driver_sql("ALTER TABLE profile_versions ADD COLUMN feedback_ids TEXT NOT NULL DEFAULT ''")
        if columns and "base_version" not in columns:
            conn.exec_driver_sql("ALTER TABLE profile_versions ADD COLUMN base_version INTEGER")


@contextmanager
def session_scope() -> Iterator[Session]:
    with SessionLocal() as session, session.begin():
        yield session
