"""Replace the directory with demo DIH employees and plan this month and next.

    python -m app.seed
"""

import random
from datetime import date

from sqlalchemy import delete, func, insert, select

from . import config
from .db import Base, SessionLocal, engine
from .models import OFFERINGS, Member, PlannedDay
from .planning import month_workdays

FIRST = ["Ahmed", "Mariam", "Omar", "Nour", "Youssef", "Salma", "Karim", "Hana",
         "Mostafa", "Farida", "Ali", "Laila", "Hassan", "Yasmin", "Tarek", "Dina",
         "Amr", "Reem", "Khaled", "Malak", "Ziad", "Jana", "Mahmoud", "Rana"]
LAST = ["Hassan", "Mansour", "Fathy", "Saeed", "Adel", "Ragab", "Nabil", "Kamal",
        "Samir", "Hamdy", "Lotfy", "Shawky", "Gamal", "Fouad", "Zaki", "Ashraf",
        "Morsy", "Hegazy", "Sherif", "Badawy", "Osman", "Rashad", "Salah", "Emad",
        "Wahba", "Farouk", "Galal", "Helmy", "Ezzat", "Yehia", "Sobhy", "Tawfik",
        "Naguib", "Abdelaziz", "Abdallah", "Mahfouz", "Ibrahim", "Soliman", "Zaher",
        "Hafez", "Raouf", "Sadek", "Mekky", "Labib", "Anwar"]
# Rough share of headcount per offering.
OFFERING_SHARE = {"Engineering": 0.30, "AI & Data": 0.22, "Customer": 0.20,
                  "Cyber": 0.16, "Enabling Functions": 0.12}
assert set(OFFERING_SHARE) == set(OFFERINGS)

PEOPLE = 1000
DOMAIN = "deloitte.com"

# Real people who take a generated person's slot: index -> (name, email).
REAL_PEOPLE = {2: ("Abdullah Hamza", "ahamzaismail@deloitte.com")}

# Days that should look quiet in the demo: date -> share of capacity.
QUIET_DAYS = {
    date(2026, 11, 19): 0.65,
    date(2026, 11, 20): 0.40,
    date(2026, 11, 23): 0.26,
    date(2026, 11, 24): 0.22,
    date(2026, 11, 25): 0.18,
    date(2026, 11, 26): 0.14,
    date(2026, 11, 27): 0.08,
    date(2026, 11, 30): 0.07,
}

# How much people like each weekday besides their mandatory Fridays (Mon=0).
APPEAL = {0: 1.0, 1: 1.35, 2: 1.25, 3: 1.0, 4: 0.25}


def weighted_sample(rng: random.Random, days: list[date], weights: list[float], n: int) -> set[date]:
    chosen: set[date] = set()
    while len(chosen) < min(n, len(days)):
        w = [0 if d in chosen else wt for d, wt in zip(days, weights)]
        chosen.add(rng.choices(days, w)[0])
    return chosen


def plan_month(rng: random.Random, year: int, month: int) -> dict[int, set[date]]:
    """Each person's days: the mandatory Fridays first, then days of their choosing."""
    workdays = month_workdays(year, month)
    fridays = [d for d in workdays if d.weekday() == config.REQUIRED_WEEKDAY]
    # Some Fridays are more popular than others (payday, team events...).
    friday_pull = [rng.uniform(0.5, 1.6) for _ in fridays]

    plans = {}
    for i in range(PEOPLE):
        days = weighted_sample(rng, fridays, friday_pull, config.REQUIRED_WEEKDAY_DAYS)
        rest = [d for d in workdays if d not in days]
        extra = rng.choice([6, 7, 8, 8, 8, 8, 9])
        days |= weighted_sample(rng, rest, [APPEAL.get(d.weekday(), 1) for d in rest], extra)
        plans[i] = days
    return plans


def apply_quiet_days():
    """Drop random generated people from QUIET_DAYS until each hits its target."""
    real = [email for _, email in REAL_PEOPLE.values()]
    with SessionLocal() as db:
        for day, share in QUIET_DAYS.items():
            target = round(config.CAPACITY * share)
            booked = db.scalars(
                select(PlannedDay.member_id).join(Member)
                .where(PlannedDay.day == day, Member.email.not_in(real))
                .order_by(func.random())
            ).all()
            kept_real = db.scalar(
                select(func.count()).select_from(PlannedDay).join(Member)
                .where(PlannedDay.day == day, Member.email.in_(real))
            )
            drop = booked[: max(0, len(booked) + kept_real - target)]
            db.execute(delete(PlannedDay).where(PlannedDay.day == day, PlannedDay.member_id.in_(drop)))
        db.commit()


def main():
    Base.metadata.create_all(engine)
    rng = random.Random(7)
    today = date.today()
    months = [(today.year, today.month), (today.year + today.month // 12, today.month % 12 + 1)]

    with SessionLocal() as db:
        db.execute(delete(Member).where(Member.email.like(f"%@{DOMAIN}")))
        offerings = rng.choices(list(OFFERING_SHARE), list(OFFERING_SHARE.values()), k=PEOPLE)
        people = []
        for i in range(PEOPLE):
            first, last = FIRST[i % len(FIRST)], LAST[(i // len(FIRST)) % len(LAST)]
            name, email = REAL_PEOPLE.get(i, (f"{first} {last}", f"{first}.{last}@{DOMAIN}".lower()))
            people.append({"name": name, "email": email, "offering": offerings[i]})
        ids = db.scalars(
            insert(Member).returning(Member.id, sort_by_parameter_order=True), people
        ).all()

        rows = [
            {"member_id": ids[i], "day": d}
            for year, month in months
            for i, days in plan_month(rng, year, month).items()
            for d in days
        ]
        db.execute(insert(PlannedDay), rows)
        db.commit()

    apply_quiet_days()
    print(f"Seeded {PEOPLE} people and {len(rows)} planned days across {len(months)} months.")
    print(f"Sign in as e.g. {people[0]['email']}")


if __name__ == "__main__":
    main()
