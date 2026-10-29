from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import date
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from . import config
from .db import Base, engine, get_db
from .models import Member, PlannedDay
from .planning import month_bounds, month_workdays, suggest_days
from .schemas import (
    CalendarOut,
    ConfigOut,
    DayOut,
    MemberOut,
    PersonOut,
    PlanIn,
    PlanOut,
    SignIn,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="Footfall", lifespan=lifespan)

Db = Annotated[Session, Depends(get_db)]
Year = Annotated[int, Query(ge=2000, le=2100)]
Month = Annotated[int, Query(ge=1, le=12)]


def get_member(db: Session, member_id: int) -> Member:
    member = db.get(Member, member_id)
    if member is None:
        raise HTTPException(404, "Member not found")
    return member


def in_month(year: int, month: int):
    start, end = month_bounds(year, month)
    return PlannedDay.day >= start, PlannedDay.day < end


@app.get("/api/config", response_model=ConfigOut)
def get_config():
    return ConfigOut(
        capacity=config.CAPACITY,
        work_days=config.WORK_DAYS,
        required_days=config.REQUIRED_DAYS,
        required_weekday=config.REQUIRED_WEEKDAY,
        required_weekday_days=config.REQUIRED_WEEKDAY_DAYS,
    )


@app.post("/api/sign-in", response_model=MemberOut)
def sign_in(body: SignIn, db: Db):
    member = db.scalar(select(Member).where(Member.email == body.email.strip().lower()))
    if member is None:
        raise HTTPException(404, "This email isn't in the DIH directory")
    return member


@app.get("/api/members/{member_id}", response_model=MemberOut)
def read_member(member_id: int, db: Db):
    return get_member(db, member_id)


@app.get("/api/calendar", response_model=CalendarOut)
def read_calendar(year: Year, month: Month, db: Db, member_id: int | None = None):
    offerings: dict[date, dict[str, int]] = defaultdict(dict)
    totals: dict[date, int] = defaultdict(int)
    for day, offering, n in db.execute(
        select(PlannedDay.day, Member.offering, func.count())
        .join(Member)
        .where(*in_month(year, month))
        .group_by(PlannedDay.day, Member.offering)
    ):
        offerings[day][offering] = n
        totals[day] += n

    colleagues: dict[date, list[PersonOut]] = defaultdict(list)
    me = db.get(Member, member_id) if member_id else None
    if me:
        for day, other_id, name in db.execute(
            select(PlannedDay.day, Member.id, Member.name)
            .join(Member)
            .where(*in_month(year, month), Member.offering == me.offering, Member.id != me.id)
            .order_by(Member.name)
        ):
            colleagues[day].append(PersonOut(id=other_id, name=name))

    return CalendarOut(
        year=year,
        month=month,
        capacity=config.CAPACITY,
        days=[
            DayOut(date=d, count=totals[d], offerings=offerings[d], colleagues=colleagues[d])
            for d in month_workdays(year, month)
        ],
    )


@app.get("/api/members/{member_id}/plan", response_model=PlanOut)
def read_plan(member_id: int, year: Year, month: Month, db: Db):
    get_member(db, member_id)
    days = db.scalars(
        select(PlannedDay.day)
        .where(PlannedDay.member_id == member_id, *in_month(year, month))
        .order_by(PlannedDay.day)
    )
    return PlanOut(days=list(days))


@app.put("/api/members/{member_id}/plan", response_model=PlanOut)
def replace_plan(member_id: int, year: Year, month: Month, body: PlanIn, db: Db):
    get_member(db, member_id)
    workdays = set(month_workdays(year, month))
    days = sorted(set(body.days))
    invalid = [d.isoformat() for d in days if d not in workdays]
    if invalid:
        raise HTTPException(422, f"Not working days in this month: {', '.join(invalid)}")

    db.execute(
        delete(PlannedDay).where(PlannedDay.member_id == member_id, *in_month(year, month))
    )
    db.add_all(PlannedDay(member_id=member_id, day=d) for d in days)
    db.commit()
    return PlanOut(days=days)


@app.get("/api/members/{member_id}/suggest", response_model=PlanOut)
def suggest_plan(member_id: int, year: Year, month: Month, db: Db):
    member = get_member(db, member_id)
    today = date.today()

    load: dict[date, int] = defaultdict(int)
    colleagues: dict[date, int] = defaultdict(int)
    mine: set[date] = set()
    for day, other_id, offering in db.execute(
        select(PlannedDay.day, PlannedDay.member_id, Member.offering)
        .join(Member)
        .where(*in_month(year, month))
    ):
        if other_id == member_id:
            mine.add(day)
            continue
        load[day] += 1
        if offering == member.offering:
            colleagues[day] += 1

    days = suggest_days(
        load=load,
        colleagues=colleagues,
        fixed={d for d in mine if d < today},
        candidates=[d for d in month_workdays(year, month) if d >= today],
        required_days=config.REQUIRED_DAYS,
        required_weekday=config.REQUIRED_WEEKDAY,
        required_weekday_days=config.REQUIRED_WEEKDAY_DAYS,
    )
    return PlanOut(days=days)


app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")
