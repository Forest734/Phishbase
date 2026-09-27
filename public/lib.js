// Helpers shared by the page modules.

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const place = (s) => [s.city, s.state ?? s.country].filter(Boolean).join(", ");

// "Sat, Nov 22, 1997", for headings.
export const formatDate = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short", year: "numeric", month: "short", day: "numeric",
  });

// "Nov 22, 1997", for lists and tables. Takes a show id or an ISO date.
export const formatDay = (iso) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });

// Resolves to the JSON the API returns for `path` (such as "shows?year=1997"),
// or null for a 404.
export { api } from "./api.js";
import { api } from "./api.js";

// "16:27", or "1:02:33" for an hour or more, from seconds.
export function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// Tag names by slug ("jamcharts" -> "Jam Charts"), fetched once.
let tags = null;
export function tagNames() {
  tags ??= api("tags")
    .then((list) => new Map(list.map((t) => [t.slug, t.name])))
    .catch((err) => {
      tags = null;
      throw err;
    });
  return tags;
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

// A table whose headers sort it. Each column: { label, cell(row) -> html,
// sort(row) -> string|number, num?, cls?, note? }, where `note` is extra
// html under the header's label. `sorted` is the initially sorted
// column. The table's data-sorted says how it's sorted now: "0" is column 0
// ascending, "0d" descending. `after(row)` is html for rows of class "detail"
// that follow a row and move with it when the table is sorted.
export function sortableTable(columns, rows, { sorted = 0, cls = "", rowAttrs = () => "", after = () => "" } = {}) {
  const classes = (c) => [c.num && "num", c.cls].filter(Boolean).join(" ");
  const head = columns
    .map((c, i) => `<th class="${classes(c)}" ${i === sorted ? 'aria-sort="ascending"' : ""}>
        <button type="button" data-col="${i}">${esc(c.label)}</button>${c.note ?? ""}</th>`)
    .join("");
  const body = rows
    .map((r, ri) => `<tr data-i="${ri}" ${rowAttrs(r)}>${columns
      .map((c) => `<td class="${classes(c)}" data-sort="${esc(c.sort(r))}">${c.cell(r)}</td>`)
      .join("")}</tr>${after(r)}`)
    .join("");
  return `<table class="sortable ${cls}" data-sorted="${sorted}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function sortTable(button) {
  const table = button.closest("table");
  const th = button.parentElement;
  const col = Number(button.dataset.col);
  const num = th.classList.contains("num");
  const dir = th.getAttribute("aria-sort") === "ascending" ? -1 : 1;
  for (const other of table.querySelectorAll("th")) other.removeAttribute("aria-sort");
  th.setAttribute("aria-sort", dir === 1 ? "ascending" : "descending");
  table.dataset.sorted = dir === 1 ? String(col) : `${col}d`;

  // Each row sorts together with the detail rows under it.
  const groups = [];
  for (const tr of table.tBodies[0].rows) {
    if (tr.classList.contains("detail")) groups.at(-1).push(tr);
    else groups.push([tr]);
  }
  const key = (tr) => tr.children[col].dataset.sort;
  groups.sort(([a], [b]) => {
    const cmp = num ? Number(key(a)) - Number(key(b)) : key(a).localeCompare(key(b));
    // Ties keep the original (chronological or alphabetical) order.
    return dir * cmp || Number(a.dataset.i) - Number(b.dataset.i);
  });
  table.tBodies[0].append(...groups.flat());
}

// A page's heading and summary line with the Phishbase donut to their left.
export const pageTitle = (heading, lede = "") =>
  `<div class="page-title"><span class="logo" aria-hidden="true"></span><div>${heading}${lede}</div></div>`;

// A thin bar for a value in a table cell, scaled to the column's largest
// value, with the number at its tip.
export const inlineBar = (value, max) =>
  `<span class="inline-bar"><span class="fill" style="--w:${value / max}"></span><span class="val">${value.toLocaleString()}</span></span>`;

// Marks a song that made Phish.net's Jam Charts.
export const JAM_MARK = `<span class="jc" title="Phish.net Jam Charts pick">★</span>`;

// A show's sets, one line each with the songs left to right, "·" between them
// (some song names have commas), and a star on Jam Charts picks.
function setlist(sets) {
  const song = (s, i, songs) => {
    const link = `<a href="#/song/${esc(s.slug)}">${esc(s.name)}</a>${s.tags.includes("jamcharts") ? JAM_MARK : ""}`;
    return i < songs.length - 1 ? `${link}<span class="sep">&nbsp;·</span>` : link;
  };
  return `<dl class="setlist">${sets
    .map((set) => `<dt>${esc(set.label)}</dt><dd>${set.songs.map(song).join(" ")}</dd>`)
    .join("")}</dl>`;
}

// Show summaries (oldest first) as a sortable table, each linking to its show.
// In date order, repeat nights at one venue are greyed after the first, which
// is tagged with the run's length, and a line marks each new month (or year).
// Lists of 8 or more also get, unless `overview` is false, a shows-per-month
// (or per-year) chart whose columns narrow the list. With `setlists` (the
// shows must carry their `sets`), each show's setlist runs under its venue.
export function showList(shows, { overview = true, setlists = false } = {}) {
  if (!shows.length) return `<p class="muted">No shows found.</p>`;
  const oneYear = shows[0].year === shows.at(-1).year;
  const periodOf = (s) => (oneYear ? s.date.slice(0, 7) : String(s.year));
  const sameVenue = (a, b) => a && b && a.venueId === b.venueId;
  const maxSongs = Math.max(1, ...shows.map((s) => s.songCount));

  const meta = new Map();
  shows.forEach((s, i) => {
    const prev = shows[i - 1];
    let run = 1;
    if (!sameVenue(prev, s)) while (sameVenue(shows[i + run - 1], shows[i + run])) run++;
    meta.set(s, {
      period: periodOf(s),
      repeat: sameVenue(prev, s),
      run: sameVenue(prev, s) ? 0 : run,
      starts: !prev || periodOf(prev) !== periodOf(s),
    });
  });
  const rowAttrs = (s) => {
    const m = meta.get(s);
    const cls = [m.repeat && "repeat", m.starts && "starts"].filter(Boolean).join(" ");
    return `class="${cls}" data-period="${m.period}"`;
  };

  const link = (s, html) => `<a href="#/show/${esc(s.id)}">${html}</a>`;
  const runTag = (s) => (meta.get(s).run > 1 ? ` <span class="run-tag">${meta.get(s).run}-show run</span>` : "");
  const photoTag = (s) => (s.photos ? ` <span class="run-tag photo-tag">${plural(s.photos, "photo")}</span>` : "");
  const table = sortableTable(
    [
      { label: "Date", cell: (s) => link(s, esc(formatDay(s.date))), sort: (s) => s.id },
      {
        label: "Venue",
        // The place repeats under the venue for phones, which hide the Location column.
        cell: (s) => `${link(s, esc(s.venue))}${runTag(s)}${photoTag(s)}<span class="where">${esc(place(s))}</span>`,
        sort: (s) => s.venue,
      },
      { label: "Location", cell: (s) => esc(place(s)), sort: (s) => place(s) },
      {
        label: "Songs",
        num: true,
        cls: "bars",
        cell: (s) => (s.songCount ? inlineBar(s.songCount, maxSongs) : `<span class="muted">—</span>`),
        sort: (s) => s.songCount,
      },
    ],
    shows,
    {
      cls: `shows${setlists ? " with-setlists" : ""}`,
      rowAttrs,
      after: (s) => (setlists && s.sets.length
        ? `<tr class="detail" data-period="${meta.get(s).period}"><td></td><td colspan="3">${setlist(s.sets)}</td></tr>`
        : ""),
    },
  );
  if (!overview || shows.length < 8) return table;
  return `<div class="show-list" data-list>${listOverview(shows, oneYear, periodOf)}${table}</div>`;
}

// Shows per month of the year (or per year, for longer lists). Each column is
// a toggle that narrows the list to its period; the hint under the chart says
// how to use it, or what's showing.
function listOverview(shows, oneYear, periodOf) {
  const counts = new Map();
  for (const s of shows) counts.set(periodOf(s), (counts.get(periodOf(s)) ?? 0) + 1);
  const first = shows[0].year;
  const periods = oneYear
    ? MONTHS.map((_, m) => `${first}-${String(m + 1).padStart(2, "0")}`)
    : Array.from({ length: shows.at(-1).year - first + 1 }, (_, i) => String(first + i));
  const label = (p) => (oneYear ? `${MONTHS[p.slice(5) - 1]} ${p.slice(0, 4)}` : p);
  const max = Math.max(...counts.values());
  const peak = periods.find((p) => counts.get(p) === max);
  const every = oneYear || periods.length <= 8 ? 1 : periods.length > 16 ? 5 : 2;
  // Every bar has its count on top. On a narrow screen a chart of more than
  // twelve columns is too tight for that, and keeps only the peak's.
  const dense = periods.length > 12;

  const cols = periods.map((p) => {
    const n = counts.get(p) ?? 0;
    const tip = plural(n, "show");
    const attrs = n ? `data-tip="${tip}" data-tip-label="${label(p)}"` : "disabled";
    const count = n ? `<span class="ov-count${p === peak ? " ov-max" : ""}">${n}</span>` : "";
    return `<button type="button" class="ov-col" data-period="${p}" data-label="${label(p)}" style="--h:${(n / max) * 100}%"
        aria-pressed="false" aria-label="${label(p)}: ${tip}" ${attrs}>${count}<span class="bar"></span></button>`;
  });
  const ticks = periods.map((p, i) => {
    const show = (oneYear ? i : Number(p)) % every === 0;
    return `<span>${show ? (oneYear ? MONTHS[i] : p) : ""}</span>`;
  });
  const hint = `Click a ${oneYear ? "month" : "year"} to see only its shows.`;
  return `<div class="overview${dense ? " dense" : ""}" style="--n:${periods.length}">
      <div class="ov-cols">${cols.join("")}</div>
      <div class="ov-axis" aria-hidden="true">${ticks.join("")}</div>
      <p class="ov-hint" aria-live="polite" data-hint="${hint}">${hint}</p>
    </div>`;
}

// Delegated listeners for show lists, attached once to #view: clicking an
// overview column shows only that period's rows; clicking it again, or
// "Show all", brings the rest back.
export function wireShowLists(view) {
  const pick = (list, col) => {
    const period = col?.dataset.period ?? "";
    list.dataset.period = period;
    // Setlist rows carry their show's period, so they come and go with it.
    for (const row of list.querySelectorAll("tbody tr")) {
      row.hidden = Boolean(period) && row.dataset.period !== period;
    }
    const rows = [...list.querySelectorAll("tbody tr:not(.detail)")];
    const shown = rows.filter((row) => !row.hidden).length;
    for (const c of list.querySelectorAll(".ov-col")) c.setAttribute("aria-pressed", String(c === col));
    list.classList.toggle("picking", Boolean(period));
    const hint = list.querySelector(".ov-hint");
    hint.innerHTML = period
      ? `${shown.toLocaleString()} of ${plural(rows.length, "show")}, in ${esc(col.dataset.label)} · <button type="button" class="link" data-list-clear>Show all</button>`
      : esc(hint.dataset.hint);
  };
  view.addEventListener("click", (e) => {
    const list = e.target.closest("[data-list]");
    if (!list) return;
    const col = e.target.closest(".ov-col");
    if (col) pick(list, list.dataset.period === col.dataset.period ? null : col);
    else if (e.target.closest("[data-list-clear]")) pick(list, null);
  });
}
