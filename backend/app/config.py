import os
from pathlib import Path

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+psycopg://footfall:footfall@localhost:5433/footfall"
)

# Desks available in the hub.
CAPACITY = int(os.getenv("OFFICE_CAPACITY", "500"))

# Python weekday numbers (Mon=0 ... Sun=6). Default: Monday to Friday.
WORK_DAYS = [int(d) for d in os.getenv("WORK_DAYS", "0,1,2,3,4").split(",")]

# Attendance policy: X days a month, of which at least N must fall on a given
# weekday (default: 10 days, including 2 Fridays).
REQUIRED_DAYS = int(os.getenv("REQUIRED_DAYS", "10"))
REQUIRED_WEEKDAY = int(os.getenv("REQUIRED_WEEKDAY", "4"))
REQUIRED_WEEKDAY_DAYS = int(os.getenv("REQUIRED_WEEKDAY_DAYS", "2"))

FRONTEND_DIR = Path(
    os.getenv("FRONTEND_DIR", Path(__file__).resolve().parents[2] / "frontend")
)
