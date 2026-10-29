const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
// Indexed by Python weekday (Mon=0 ... Sun=6), matching the API.
const WD_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WD_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TONES = [[0, "#c5d6bb"], [0.5, "#e4c36e"], [0.8, "#dc7a4c"], [1, "#b5412c"]];
const STORE_KEY = "footfall.member";
const PENCIL = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M11 2.5l2.5 2.5L5.5 13H3v-2.5z"/><path d="M9.5 4l2.5 2.5"/></svg>`;

const state = {
  cfg: null,
  year: 0,
  month: 0,
  cal: null,
  me: null,
  mine: new Set(), // my days as saved on the server
  draft: null, // my days while editing; null when not editing
  saving: false,
  focus: null,
  hover: null,
};

const $ = (sel) => document.querySelector(sel);
const today = isoOf(new Date());

/* ---------- helpers ---------- */

function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseIso(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
const pyWeekday = (d) => (d.getDay() + 6) % 7;
const isRequired = (iso) => pyWeekday(parseIso(iso)) === state.cfg.required_weekday;
const reqName = () => WD_LONG[state.cfg.required_weekday];

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function tone(r) {
  const x = Math.max(0, Math.min(1, r));
  for (let i = 1; i < TONES.length; i++) {
    const [p1, c1] = TONES[i];
    const [p0, c0] = TONES[i - 1];
    if (x <= p1) return mix(c0, c1, (x - p0) / (p1 - p0));
  }
  return TONES.at(-1)[1];
}
function mix(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
function verdict(r) {
  if (r < 0.4) return "Quiet";
  if (r < 0.7) return "Steady";
  if (r < 0.9) return "Busy";
  return r > 1 ? "Over capacity" : "Packed";
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = Array.isArray(body.detail) ? body.detail[0]?.msg : body.detail;
    throw new Error(detail || res.statusText);
  }
  return res.json();
}

let toastTimer;
function flash(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function loadMe() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; }
}
function saveMe(member) {
  try {
    if (member) localStorage.setItem(STORE_KEY, JSON.stringify(member));
    else localStorage.removeItem(STORE_KEY);
  } catch { /* storage unavailable: the session just won't be remembered */ }
}

/* ---------- derived data ---------- */

const monthQuery = () => `year=${state.year}&month=${state.month}`;
const calendarUrl = () => `/api/calendar?${monthQuery()}${state.me ? `&member_id=${state.me.id}` : ""}`;
const editing = () => state.draft !== null;
const chosen = () => state.draft ?? state.mine;

function changes() {
  if (!editing()) return 0;
  let n = 0;
  for (const d of state.draft) if (!state.mine.has(d)) n++;
  for (const d of state.mine) if (!state.draft.has(d)) n++;
  return n;
}

// The server count already includes my saved days; swap in my draft.
function countFor(day) {
  return day.count - (state.mine.has(day.date) ? 1 : 0) + (chosen().has(day.date) ? 1 : 0);
}

function weeksOfMonth() {
  const start = state.cfg.work_days[0];
  const weeks = new Map();
  for (const day of state.cal.days) {
    const d = parseIso(day.date);
    const ws = new Date(d);
    ws.setDate(d.getDate() - ((pyWeekday(d) - start + 7) % 7));
    const key = isoOf(ws);
    if (!weeks.has(key)) weeks.set(key, {});
    weeks.get(key)[pyWeekday(d)] = day;
  }
  return [...weeks.values()];
}

const dayByDate = (iso) => state.cal.days.find((d) => d.date === iso);
const dayLabel = (d) => { const dt = parseIso(d.date); return `${WD_LONG[pyWeekday(dt)]} ${dt.getDate()}`; };

/* ---------- rendering ---------- */

function render() {
  document.body.classList.toggle("editing", editing());
  renderHeader();
  renderLede();
  renderEditbar();
  renderGrid();
  renderMe();
  renderDay();
}

function renderHeader() {
  $("#monthLabel").innerHTML = `${MONTHS[state.month - 1]} <em>${state.year}</em>`;
  $("#who").innerHTML = state.me
    ? `<span class="ini">${esc(initials(state.me.name))}</span>
       <span>${esc(state.me.name)}<small>${esc(state.me.offering)}</small></span>
       <button class="link" data-act="logout">switch</button>`
    : "";
  const anyAhead = state.cal.days.some((d) => d.date >= today);
  $("#headAction").innerHTML = editing() || !anyAhead
    ? ""
    : `<button class="btn primary" data-act="edit">${PENCIL}Update my days</button>`;
  $("#hint").textContent = editing()
    ? "Tap days to add or remove them. Nothing changes until you save."
    : "Tap a day to see who's in. The shading shows how many desks are spoken for.";
}

function renderLede() {
  const ahead = state.cal.days.filter((d) => d.date >= today);
  if (!ahead.length) {
    $("#lede").innerHTML = "This month is behind us. <b>Look ahead</b> to plan your next days in.";
    return;
  }
  const by = [...ahead].sort((a, b) => countFor(a) - countFor(b));
  const quiet = by[0];
  const busy = by.at(-1);
  if (ahead.length === 1) {
    $("#lede").innerHTML = `Only <b>${dayLabel(quiet)}</b> is left this month, with ${countFor(quiet)} people in. <b>Look ahead</b> to plan the next one.`;
    return;
  }
  if (countFor(busy) === 0) {
    $("#lede").innerHTML = "Nobody has planned anything yet. <b>Be the first.</b>";
    return;
  }
  const quietReq = by.find((d) => isRequired(d.date));
  const reqLine = quietReq && quietReq !== quiet
    ? ` Calmest ${reqName()}: <b class="q">${parseIso(quietReq.date).getDate()}</b>.`
    : "";
  $("#lede").innerHTML = `Quietest ahead is <b class="q">${dayLabel(quiet)}</b>; avoid <b class="p">${dayLabel(busy)}</b> if you want a desk by the window.${reqLine}`;
}

function renderEditbar() {
  const el = $("#editbar");
  if (!editing()) { el.innerHTML = ""; return; }

  const { required_days: needDays, required_weekday_days: needReq } = state.cfg;
  const days = state.draft.size;
  const req = [...state.draft].filter(isRequired).length;
  const n = changes();
  el.innerHTML = `
    <div class="editbar" role="region" aria-label="Editing your days">
      <div>
        <span class="eb-title">Editing your ${MONTHS[state.month - 1]}</span>
        <span class="eb-stats">
          <span class="${days >= needDays ? "ok" : ""}">${days}/${needDays} days</span> ·
          <span class="${req >= needReq ? "ok" : ""}">${Math.min(req, needReq)}/${needReq} ${reqName()}s</span> ·
          ${n ? `${n} unsaved change${n > 1 ? "s" : ""}` : "no changes yet"}
        </span>
      </div>
      <div class="eb-actions">
        <button class="btn light" data-act="suggest">Suggest quiet days</button>
        <button class="btn light" data-act="cancel">Cancel</button>
        <button class="btn save" data-act="save" ${n && !state.saving ? "" : "disabled"}>${state.saving ? "Saving…" : "Save changes"}</button>
      </div>
    </div>`;
}

function renderGrid() {
  const cols = state.cfg.work_days;
  const cap = state.cal.capacity;
  const grid = $("#grid");
  grid.style.setProperty("--cols", cols.length);
  grid.classList.toggle("editing", editing());

  let html = `<span></span>` + cols.map((c) => c === state.cfg.required_weekday
    ? `<div class="col-head req">${WD_SHORT[c]} <span>pick ${state.cfg.required_weekday_days}</span></div>`
    : `<div class="col-head">${WD_SHORT[c]}</div>`).join("");
  weeksOfMonth().forEach((week, i) => {
    html += `<span class="week-label">W${i + 1}</span>`;
    for (const c of cols) {
      const day = week[c];
      html += day ? cellHtml(day, cap) : `<div class="cell blank" aria-hidden="true"></div>`;
    }
  });
  grid.innerHTML = html;
}

function cellHtml(day, cap) {
  const n = countFor(day);
  const r = n / cap;
  const going = chosen().has(day.date);
  const saved = state.mine.has(day.date);
  const added = editing() && going && !saved;
  const removed = editing() && !going && saved;
  const past = day.date < today;
  const mates = day.colleagues.length;
  const cls = ["cell",
    going && "mine",
    added && "added",
    removed && "removed",
    past && "past",
    day.date === today && "today",
    day.date === state.focus && !editing() && "focus",
    r >= 0.9 && "hot",
    r > 1 && "over"].filter(Boolean).join(" ");

  let tag = "";
  if (added) tag = `<span class="tag">new</span>`;
  else if (removed) tag = `<span class="tag">removed</span>`;
  else if (going) tag = `<span class="tag">you</span>`;
  else if (editing() && !past) tag = `<span class="plus" aria-hidden="true">+</span>`;

  const dt = parseIso(day.date);
  return `
    <button class="${cls}" data-date="${day.date}" style="--r:${r.toFixed(3)};--tone:${tone(r)}"
      ${editing() ? `aria-pressed="${going}"` : ""}
      aria-label="${WD_LONG[pyWeekday(dt)]} ${dt.getDate()}, ${n} of ${cap} desks${going ? ", you're going" : ""}">
      <span class="fill"></span>
      <span class="top-row"><span class="num">${dt.getDate()}</span>${tag}</span>
      <span class="meta">
        <span><b>${n}</b><span class="cap">/${cap}</span></span>
        ${mates ? `<span class="mates" title="${mates} from ${esc(state.me.offering)}">${mates} yours</span>` : ""}
      </span>
    </button>`;
}

function renderMe() {
  const el = $("#me");
  if (!state.me) {
    el.innerHTML = `
      <p class="eyebrow">Before you plan</p>
      <h2 class="h">Who's coming in?</h2>
      <p class="join-sub">Sign in with your work email. Your name and offering come from the DIH directory.</p>
      <form class="join" id="joinForm">
        <label>Work email<input name="email" type="email" required autocomplete="email" placeholder="you@deloitte.com"></label>
        <button class="btn primary">Sign in</button>
      </form>
      <p class="muted">Demo: try <code>ahmed.hassan@deloitte.com</code></p>`;
    return;
  }

  const { required_days: needDays, required_weekday_days: needReq } = state.cfg;
  const days = chosen();
  const reqCount = [...days].filter(isRequired).length;

  const pips = weeksOfMonth().map((w, i) => `
    <div class="wk">
      <div class="pips">${state.cfg.work_days.map((c) => {
        const d = w[c];
        if (!d) return `<i style="visibility:hidden"></i>`;
        const cls = [days.has(d.date) && "on", c === state.cfg.required_weekday && "req"];
        return `<i class="${cls.filter(Boolean).join(" ")}"></i>`;
      }).join("")}</div>
      <span>W${i + 1}</span>
    </div>`).join("");

  let bottom;
  if (editing()) {
    bottom = `<p class="note">Tap days on the calendar to add or remove them, then press <b>Save changes</b>.</p>`;
  } else {
    const list = [...days].sort().map((iso) => {
      const dt = parseIso(iso);
      const cls = [isRequired(iso) && "req", iso < today && "past"].filter(Boolean).join(" ");
      return `<li class="${cls}">${WD_SHORT[pyWeekday(dt)]} ${dt.getDate()}</li>`;
    }).join("");
    const anyAhead = state.cal.days.some((d) => d.date >= today);
    bottom = `
      ${list ? `<ul class="my-days">${list}</ul>` : `<p class="muted" style="margin:0 0 18px">You haven't picked any days yet.</p>`}
      ${anyAhead ? `<button class="btn primary block" data-act="edit">${PENCIL}${days.size ? "Update my days" : "Plan my days"}</button>` : ""}`;
  }

  el.innerHTML = `
    <p class="eyebrow">${editing() ? "Editing · " : ""}Your ${MONTHS[state.month - 1]}</p>
    <div class="tally"><span class="big">${days.size}</span><span class="of">of ${needDays} days</span></div>
    <div class="weeks">${pips}</div>
    <ul class="rules">
      <li class="${days.size >= needDays ? "ok" : ""}">${needDays} days in the office <span class="count">${Math.min(days.size, needDays)}/${needDays}</span></li>
      <li class="${reqCount >= needReq ? "ok" : ""}">Including ${needReq} ${reqName()}s <span class="count">${Math.min(reqCount, needReq)}/${needReq}</span></li>
    </ul>
    ${bottom}`;
}

function renderDay() {
  const el = $("#day");
  const day = dayByDate(state.hover ?? state.focus);
  if (!day) { el.innerHTML = ""; return; }

  const dt = parseIso(day.date);
  const n = countFor(day);
  const r = n / state.cal.capacity;
  const going = chosen().has(day.date);
  const past = day.date < today;
  const myOffering = state.me?.offering ?? null;

  let button = "";
  if (editing() && !past) {
    button = going
      ? `<button class="btn block" data-act="toggle" data-date="${day.date}">Remove this day</button>`
      : `<button class="btn primary block" data-act="toggle" data-date="${day.date}">Add this day</button>`;
  }

  // My offering: names, with me placed according to my current choice.
  let mineBlock = "";
  if (myOffering) {
    const people = [...day.colleagues];
    if (going) people.push({ id: state.me.id, name: state.me.name });
    people.sort((a, b) => a.name.localeCompare(b.name));
    mineBlock = `
      <div class="block">
        <h4 class="yours"><span>${esc(myOffering)} · your offering</span><span>${people.length}</span></h4>
        ${people.length
          ? `<ul class="chips">${people.map((p) => `
              <li class="${p.id === state.me.id ? "me" : ""}"><span class="ini">${esc(initials(p.name))}</span>${esc(p.name)}</li>`).join("")}</ul>`
          : `<p class="muted">Nobody from your offering yet.</p>`}
      </div>`;
  }

  // Everyone else: headcount per offering.
  const others = Object.entries(day.offerings)
    .filter(([o]) => o !== myOffering)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  const max = Math.max(1, ...others.map(([, c]) => c));
  const otherRows = others.map(([o, c]) => `
    <li><span class="t">${esc(o)}</span><i style="--w:${c / max}"></i><b>${c}</b></li>`).join("");

  const status = day.date === today ? " · today" : past ? " · past" : going ? " · you're going" : "";
  el.innerHTML = `
    <p class="eyebrow">${WD_LONG[pyWeekday(dt)]}${status}</p>
    <h2 class="h">${dt.getDate()} ${MONTHS[dt.getMonth()]}</h2>
    <div class="gauge" style="--tone:${tone(r)}"><i style="width:${Math.min(r, 1) * 100}%"></i></div>
    <p class="gauge-label"><span><b>${n}</b> of ${state.cal.capacity} desks</span><span class="verdict">${verdict(r)}</span></p>
    ${button}
    ${n === 0 ? `<p class="empty">Nobody's planned this day yet. You'd have the pick of the floor.</p>` : `
    <div class="people">
      ${mineBlock}
      ${others.length ? `
      <div class="block">
        <h4><span>${myOffering ? "Other offerings" : "By offering"}</span><span>${others.reduce((s, [, c]) => s + c, 0)}</span></h4>
        <ul class="offering-bars">${otherRows}</ul>
      </div>` : ""}
    </div>`}`;
}

/* ---------- data flow ---------- */

async function loadMonth() {
  history.replaceState(null, "", `#${state.year}-${String(state.month).padStart(2, "0")}`);
  state.draft = null;
  state.hover = null;
  const [cal, plan] = await Promise.all([
    api(calendarUrl()),
    state.me ? api(`/api/members/${state.me.id}/plan?${monthQuery()}`) : { days: [] },
  ]);
  state.cal = cal;
  state.mine = new Set(plan.days);
  const dates = cal.days.map((d) => d.date);
  if (!dates.includes(state.focus)) {
    state.focus = dates.includes(today) ? today : dates.find((d) => d >= today) ?? dates[0];
  }
  render();
}

// Returns false if the user wants to keep their unsaved edits.
function okToLeaveEdit() {
  return !changes() || confirm("You have unsaved changes to your days. Discard them?");
}

function startEdit() {
  if (!state.me) {
    flash("Tell us who you are first");
    const input = document.querySelector("#joinForm input");
    input?.scrollIntoView({ behavior: "smooth", block: "center" });
    input?.focus({ preventScroll: true });
    return;
  }
  state.draft = new Set(state.mine);
  render();
}

function cancelEdit() {
  if (!okToLeaveEdit()) return;
  state.draft = null;
  render();
}

async function saveEdit() {
  if (!changes() || state.saving) return;
  state.saving = true;
  renderEditbar();
  try {
    const res = await api(`/api/members/${state.me.id}/plan?${monthQuery()}`, {
      method: "PUT",
      body: JSON.stringify({ days: [...state.draft] }),
    });
    state.cal = await api(calendarUrl());
    state.mine = new Set(res.days);
    state.draft = null;
    flash("Your days are saved");
  } catch (err) {
    flash(`Couldn't save: ${err.message}`);
  } finally {
    state.saving = false;
    render();
  }
}

function clickDay(date) {
  state.focus = date;
  if (editing() && date >= today) {
    if (state.draft.has(date)) state.draft.delete(date);
    else state.draft.add(date);
  }
  render();
}

async function suggest() {
  try {
    const res = await api(`/api/members/${state.me.id}/suggest?${monthQuery()}`);
    state.draft = new Set(res.days);
    render();
    flash("Picked your quietest days. Review them, then save.");
  } catch (err) {
    flash(err.message);
  }
}

/* ---------- events ---------- */

const actions = {
  prev: () => shiftMonth(-1),
  next: () => shiftMonth(1),
  edit: startEdit,
  cancel: cancelEdit,
  save: saveEdit,
  suggest,
  toggle: (el) => clickDay(el.dataset.date),
  logout: () => {
    if (!okToLeaveEdit()) return;
    state.me = null;
    saveMe(null);
    loadMonth();
  },
};

function shiftMonth(step) {
  if (!okToLeaveEdit()) return;
  const m = state.month - 1 + step;
  state.year += Math.floor(m / 12);
  state.month = ((m % 12) + 12) % 12 + 1;
  loadMonth().catch((err) => flash(err.message));
}

document.addEventListener("click", (e) => {
  const actEl = e.target.closest("[data-act]");
  if (actEl) {
    actions[actEl.dataset.act]?.(actEl);
    return;
  }
  const cell = e.target.closest(".cell[data-date]");
  if (cell) clickDay(cell.dataset.date);
});

$("#grid").addEventListener("mouseover", (e) => {
  const cell = e.target.closest(".cell[data-date]");
  if (cell && cell.dataset.date !== state.hover) {
    state.hover = cell.dataset.date;
    renderDay();
  }
});
$("#grid").addEventListener("mouseleave", () => {
  state.hover = null;
  renderDay();
});

document.addEventListener("submit", async (e) => {
  if (e.target.id !== "joinForm") return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    state.me = await api("/api/sign-in", { method: "POST", body: JSON.stringify(data) });
    saveMe(state.me);
    await loadMonth();
    flash(`Welcome, ${state.me.name.split(" ")[0]}`);
  } catch (err) {
    flash(err.message);
  }
});

window.addEventListener("beforeunload", (e) => {
  if (changes()) e.preventDefault();
});

/* ---------- boot ---------- */

(async function init() {
  const now = new Date();
  state.year = now.getFullYear();
  state.month = now.getMonth() + 1;
  const linked = location.hash.match(/^#(\d{4})-(\d{2})$/);
  if (linked && +linked[2] >= 1 && +linked[2] <= 12) {
    state.year = +linked[1];
    state.month = +linked[2];
  }
  try {
    state.cfg = await api("/api/config");
    const saved = loadMe();
    if (saved?.id) {
      try { state.me = await api(`/api/members/${saved.id}`); } catch { saveMe(null); }
    }
    await loadMonth();
  } catch (err) {
    flash(`Can't reach the server: ${err.message}`);
  }
})();
