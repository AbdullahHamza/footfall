from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class ConfigOut(BaseModel):
    capacity: int
    work_days: list[int]
    required_days: int
    required_weekday: int
    required_weekday_days: int


class SignIn(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=200)


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str
    offering: str


class PersonOut(BaseModel):
    id: int
    name: str


class DayOut(BaseModel):
    date: date
    count: int
    # Headcount per offering.
    offerings: dict[str, int]
    # People from the requesting member's offering, excluding the member.
    colleagues: list[PersonOut]


class CalendarOut(BaseModel):
    year: int
    month: int
    capacity: int
    days: list[DayOut]


class PlanIn(BaseModel):
    days: list[date]


class PlanOut(BaseModel):
    days: list[date]
