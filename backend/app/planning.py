import calendar
from datetime import date

from . import config


def month_bounds(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    end = date(year + month // 12, month % 12 + 1, 1)
    return start, end


def month_workdays(year: int, month: int) -> list[date]:
    _, days_in_month = calendar.monthrange(year, month)
    days = (date(year, month, i) for i in range(1, days_in_month + 1))
    return [d for d in days if d.weekday() in config.WORK_DAYS]


def suggest_days(
    load: dict[date, int],
    colleagues: dict[date, int],
    fixed: set[date],
    candidates: list[date],
    required_days: int,
    required_weekday: int,
    required_weekday_days: int,
) -> list[date]:
    """Pick the quietest days that still satisfy the attendance policy.

    `fixed` days are kept as they are (e.g. already-past planned days). The
    mandatory weekdays (e.g. two Fridays) are filled first with the quietest
    ones, then the rest of the month. Ties on load are broken in favour of days
    where more people from the member's offering are coming in.
    """
    ranked = sorted(
        (d for d in candidates if d not in fixed),
        key=lambda d: (load.get(d, 0), -colleagues.get(d, 0), d),
    )
    have = sum(d.weekday() == required_weekday for d in fixed)
    musts = [d for d in ranked if d.weekday() == required_weekday]
    musts = musts[: max(0, required_weekday_days - have)]

    need = max(0, required_days - len(fixed) - len(musts))
    others = [d for d in ranked if d not in musts][:need]

    return sorted([*fixed, *musts, *others])
