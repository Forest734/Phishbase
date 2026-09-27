// Hash router: #/, #/year/1997, #/show/1997-11-22, #/tours, #/songs,
// #/song/<slug>, #/search?q=..., #/stats?<filters>, and #/shows?<filters>,
// where <filters> are any of the /api/shows filters.
import { api, esc, formatDay, inlineBar, pageTitle, showList, sortableTable, sortTable, wireShowLists } from "./lib.js";
import { describeFilters, statsPage, wireStats } from "./stats.js";
import { showPage } from "./show.js";

const view = document.getElementById("view");

const routes = {
  async home() {
    const years = await api("years");
    const total = years.reduce((n, y) => n + y.count, 0);
    const heading = `<h2>${total.toLocaleString()} shows, ${years[0].year}–${years.at(-1).year}</h2>`;
    return `${pageTitle(heading, `<p class="lede">Pick a year to see its shows.</p>`)}
      <ul class="years">${years
        .map((y) => y.count
          ? `<li><a href="#/year/${y.year}"><strong>${y.year}</strong><span>${y.count} shows</span></a></li>`
          : `<li><span class="off"><strong>${y.year}</strong><span>no shows</span></span></li>`)
        .join("")}</ul>`;
  },

  async year(year) {
    const shows = await api(`shows?year=${encodeURIComponent(year)}&sets=1`);
    const y = Number(year);
    return `<p class="pager">
        <a href="#/year/${y - 1}">← ${y - 1}</a>
        <a href="#/year/${y + 1}">${y + 1} →</a>
      </p>
      ${pageTitle(
        `<h2>${esc(year)} <span class="muted">· ${shows.length} shows</span></h2>`,
        shows.length ? `<p class="lede">${esc(formatDay(shows[0].date))} to ${esc(formatDay(shows.at(-1).date))}. ★ marks a Phish.net Jam Charts pick.</p>` : "",
      )}
      ${showList(shows, { setlists: true })}`;
  },

  show: (id) => showPage(id),

  async tours() {
    const tours = await api("tours");
    const max = Math.max(...tours.map((t) => t.count));
    const range = (t) => (t.first === t.last ? formatDay(t.first) : `${formatDay(t.first)} to ${formatDay(t.last)}`);
    return `${pageTitle(`<h2>${tours.length} tours</h2>`, `<p class="lede">As phish.in groups the shows. Click a tour for its shows.</p>`)}
      ${sortableTable(
        [
          { label: "Tour", cell: (t) => `<a href="#/shows?tour=${esc(t.slug)}">${esc(t.name)}</a>`, sort: (t) => t.name },
          { label: "Dates", cell: (t) => esc(range(t)), sort: (t) => t.first },
          { label: "Shows", num: true, cls: "bars", cell: (t) => inlineBar(t.count, max), sort: (t) => t.count },
        ],
        tours,
        { sorted: 1, cls: "tours" },
      )}`;
  },

  async songs() {
    const songs = await api("songs");
    const showLink = (id) => `<a href="#/show/${esc(id)}">${esc(formatDay(id))}</a>`;
    const maxCount = Math.max(...songs.map((s) => s.count));
    // Years played, as a bar on one timeline shared by every song.
    const year = (id) => Number(id.slice(0, 4));
    const lo = Math.min(...songs.map((s) => year(s.first)));
    const hi = Math.max(...songs.map((s) => year(s.last)));
    const x = (y) => ((y - lo) / (hi - lo + 1)) * 100;
    const span = (s) => {
      const [a, b] = [year(s.first), year(s.last)];
      const years = a === b ? String(a) : `${a}–${b}`;
      return `<span class="span-track" data-tip="${years}" data-tip-label="${esc(s.name)}" role="img" aria-label="Played ${a === b ? `in ${a}` : `from ${a} to ${b}`}">
        <span class="span-fill" style="left:${x(a)}%;width:${x(b + 1) - x(a)}%"></span></span>`;
    };
    const by = (s) => (s.artist ? `<span class="by">${esc(s.artist)}</span>` : "");
    return `${pageTitle(`<h2>${songs.length.toLocaleString()} songs</h2>`, `<p class="lede">Covers show their original artist. Click a column heading to sort, or filter by name.</p>`)}
      <input id="song-filter" type="search" placeholder="Filter songs" aria-label="Filter songs">
      ${sortableTable(
        [
          { label: "Song", cell: (s) => `<a href="#/song/${esc(s.slug)}">${esc(s.name)}</a>${by(s)}`, sort: (s) => s.name },
          { label: "Shows", num: true, cls: "bars", cell: (s) => inlineBar(s.count, maxCount), sort: (s) => s.count },
          {
            label: "Years played",
            note: `<span class="span-axis" aria-hidden="true"><span>${lo}</span><span>${hi}</span></span>`,
            num: true,
            cls: "span-col",
            cell: span,
            sort: (s) => year(s.last) - year(s.first),
          },
          { label: "First", cell: (s) => showLink(s.first), sort: (s) => s.first },
          { label: "Last", cell: (s) => showLink(s.last), sort: (s) => s.last },
        ],
        songs,
        { cls: "songs", rowAttrs: (s) => `data-name="${esc(`${s.name} ${s.artist ?? ""}`.toLowerCase())}"` },
      )}`;
  },

  async song(slug) {
    const s = await api(`songs/${encodeURIComponent(slug)}`);
    if (!s) return `<h2>Song not found</h2>`;
    const dates = `${esc(formatDay(s.shows[0].date))} to ${esc(formatDay(s.shows.at(-1).date))}`;
    const cover = s.artist ? ` A cover of ${esc(s.artist)}.` : "";
    const jams = s.jamcharts
      ? ` <a href="#/shows?song=${esc(s.slug)}&amp;tag=jamcharts">${s.jamcharts} Jam Charts ${s.jamcharts === 1 ? "pick" : "picks"}</a>.`
      : "";
    return `${pageTitle(`<h2>${esc(s.name)}</h2>`, `<p class="lede">Played at ${s.count} ${s.count === 1 ? "show" : "shows"}, ${dates}.${cover}${jams}</p>`)}
      ${showList(s.shows)}`;
  },

  async search(_arg, params) {
    const q = params.get("q") ?? "";
    const shows = await api(`shows?q=${encodeURIComponent(q)}`);
    return `<h2>Shows matching “${esc(q)}” <span class="muted">· ${shows.length}</span></h2>${showList(shows)}`;
  },

  stats: (_arg, params) => statsPage(params),

  // Where the stats page drills down to; takes any /api/shows filter.
  async shows(_arg, params) {
    const shows = await api(`shows?${params}`);
    const title = await describeFilters(params, shows);
    return `<h2>${esc(title)} <span class="muted">· ${shows.length} shows</span></h2>${showList(shows)}`;
  },
};

let renders = 0;
let lastPath = null;

async function render() {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const [name, arg] = path.split("/").map(decodeURIComponent);
  const route = routes[name || "home"];
  const current = ++renders;
  // The old page stays up, dimmed, until the new one is ready.
  view.classList.add("loading");
  let html;
  try {
    html = route ? await route(arg, new URLSearchParams(query)) : `<h2>Page not found</h2>`;
  } catch (err) {
    html = `<h2>Something went wrong</h2><p class="muted">${esc(err.message)}</p>`;
  }
  if (current !== renders) return; // a later navigation won
  view.innerHTML = html;
  view.classList.remove("loading");
  // Changing only the query (a new stats range) keeps the scroll position.
  if (path !== lastPath) window.scrollTo(0, 0);
  lastPath = path;
}

// Start over is a link home. Filters live in the URL, so leaving a page drops
// them; the search box is the one thing that keeps its text, so clear it.
document.getElementById("start-over").addEventListener("click", () => {
  document.getElementById("search").q.value = "";
  window.scrollTo(0, 0); // already home: no hashchange, so no render to scroll
});

document.getElementById("search").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
});

view.addEventListener("input", (e) => {
  if (e.target.id !== "song-filter") return;
  const needle = e.target.value.trim().toLowerCase();
  for (const row of view.querySelectorAll("tbody tr")) {
    row.hidden = !row.dataset.name.includes(needle);
  }
});

view.addEventListener("click", (e) => {
  const button = e.target.closest("th button[data-col]");
  if (button) sortTable(button);
});

wireStats(view);
wireShowLists(view);
window.addEventListener("hashchange", render);
render();
