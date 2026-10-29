from datetime import date, datetime

from sqlalchemy import Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

OFFERINGS = ("Customer", "Cyber", "AI & Data", "Engineering", "Enabling Functions")


class Member(Base):
    """A DIH employee. Mirrors the DIH directory: people are not created from the app."""

    __tablename__ = "members"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    offering: Mapped[str] = mapped_column(Enum(*OFFERINGS, name="offering"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class PlannedDay(Base):
    """One row per member per day they plan to be in the office."""

    __tablename__ = "planned_days"

    member_id: Mapped[int] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[date] = mapped_column(primary_key=True, index=True)

    member: Mapped[Member] = relationship()
