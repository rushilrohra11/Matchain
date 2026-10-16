from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from sqlalchemy import Float, String, Text, create_engine, select, update
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DATABASE_PATH = PROJECT_ROOT / "backend" / "data" / "matchain.sqlite3"


class Base(DeclarativeBase):
    pass


class DiscoveryJobRecord(Base):
    __tablename__ = "discovery_jobs"

    job_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    created_at: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    updated_at: Mapped[float] = mapped_column(Float, nullable=False)
    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    request_json: Mapped[str] = mapped_column(Text, nullable=False)
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class JobsStore:
    def __init__(self, database_path: Path = DEFAULT_DATABASE_PATH) -> None:
        database_path.parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(
            f"sqlite:///{database_path.as_posix()}",
            connect_args={"check_same_thread": False},
        )
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        Base.metadata.create_all(self.engine)
        self.mark_interrupted_jobs()

    def mark_interrupted_jobs(self) -> None:
        with self.sessions.begin() as session:
            session.execute(
                update(DiscoveryJobRecord)
                .where(DiscoveryJobRecord.status.in_(("queued", "running")))
                .values(
                    status="failed",
                    error="Backend restarted before this discovery job completed.",
                    updated_at=time.time(),
                )
            )

    def create(self, job_id: str, payload: dict[str, Any], timestamp: float) -> None:
        with self.sessions.begin() as session:
            session.add(DiscoveryJobRecord(
                job_id=job_id,
                status="queued",
                created_at=timestamp,
                updated_at=timestamp,
                progress=0.0,
                request_json=json.dumps(payload, default=_json_default),
            ))

    def update(self, job_id: str, timestamp: float, **values: Any) -> None:
        if "result" in values:
            values["result_json"] = json.dumps(values.pop("result"), default=_json_default)
        allowed = {"status", "updated_at", "progress", "result_json", "error"}
        fields = {key: value for key, value in values.items() if key in allowed}
        fields["updated_at"] = timestamp
        with self.sessions.begin() as session:
            session.execute(update(DiscoveryJobRecord).where(DiscoveryJobRecord.job_id == job_id).values(**fields))

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self.sessions() as session:
            record = session.get(DiscoveryJobRecord, job_id)
            return _as_job(record) if record else None

    def recent(self, limit: int = 5) -> list[dict[str, Any]]:
        with self.sessions() as session:
            records = session.scalars(
                select(DiscoveryJobRecord).order_by(DiscoveryJobRecord.created_at.desc()).limit(limit)
            ).all()
            return [_as_job(record) for record in records]

    def all_completed(self) -> list[dict[str, Any]]:
        with self.sessions() as session:
            records = session.scalars(
                select(DiscoveryJobRecord).where(DiscoveryJobRecord.status == "completed").order_by(DiscoveryJobRecord.created_at)
            ).all()
            return [_as_job(record) for record in records]


def _json_default(value: Any) -> Any:
    if hasattr(value, "as_dict"):
        return {"__matchain_pymatgen_structure__": value.as_dict()}
    if hasattr(value, "tolist"):
        return value.tolist()
    if hasattr(value, "item"):
        return value.item()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _as_job(record: DiscoveryJobRecord) -> dict[str, Any]:
    return {
        "job_id": record.job_id,
        "status": record.status,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
        "progress": record.progress,
        "request": json.loads(record.request_json),
        "payload": json.loads(record.request_json),
        "result": json.loads(record.result_json) if record.result_json else None,
        "error": record.error,
    }
