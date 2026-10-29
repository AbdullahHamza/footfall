# Footfall: DIH office planner (POC)

People mark the days they plan to be in the hub, and everyone sees how full each day will be,
so you can pick quieter days that still meet the policy (10 days a month, including 2 Fridays).

## Run

```bash
docker compose up -d --build
docker compose exec api python -m app.seed   # 1000 demo employees + plans for this month and next
```

Sign in with an email from the directory, e.g. `ahmed.hassan@deloitte.com`.

## Employees

`members` mirrors the DIH directory (name, email, offering). The app never creates people;
sign-in only looks them up by email. Offerings: Customer, Cyber, AI & Data, Engineering,
Enabling Functions. For now `app.seed` fills it with demo data; later it will be synced from
the DIH database.

Open http://localhost:8765. API docs: http://localhost:8765/docs

Host ports are set by `API_PORT` (default 8765) and `DB_PORT` (default 5433). If one is taken,
override it: `API_PORT=9000 docker compose up -d`, or put it in a `.env` file next to
`docker-compose.yml`.

## Config (env vars on the `api` service)

| Var | Default | Meaning |
|---|---|---|
| `OFFICE_CAPACITY` | 500 | Desks in the hub |
| `WORK_DAYS` | `0,1,2,3,4` | Python weekdays (Mon=0); default Mon–Fri |
| `REQUIRED_DAYS` | 10 | Days per month |
| `REQUIRED_WEEKDAY` | 4 | Weekday that has a minimum (4 = Friday) |
| `REQUIRED_WEEKDAY_DAYS` | 2 | How many of those days are required |

## Layout

- `backend/app/main.py`: FastAPI routes; also serves the frontend
- `backend/app/planning.py`: workdays, weeks, and the quiet-day suggestion logic
- `frontend/`: plain HTML/CSS/JS, no build step

## Later phases

QR check-in for actual attendance; DeskHub export import.
