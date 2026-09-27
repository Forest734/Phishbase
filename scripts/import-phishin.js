// Fetches every show and track from the phish.in API v2 (https://phish.in,
// open source, no key needed) and writes the app's data:
//
//   data/shows.json         shows, setlists, tours and songs; loaded up front
//   data/notes/YYYY.json    each show's notes (taper notes, and the notes on
//                           its tags), loaded only when a show page opens
//
//   npm run import                        # about 85 requests, ~20 minutes
//   npm run import -- --cache /tmp/phishin   # keep (or reuse) the raw pages
//
// Requests are paced a second apart and retried, as phish.in asks API users
// to be gentle. The track list is the slow part: pages of 500 take ~15s each.
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const API = "https://phish.in/api/v2";
const HEADERS = { "User-Agent": "Phishbase importer (https://github.com/Forest734/Phishbase)", Accept: "application/json" };

const args = process.argv.slice(2);
const cacheDir = args.includes("--cache") ? args[args.indexOf("--cache") + 1] : null;
if (cacheDir) mkdirSync(cacheDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(path, cacheName) {
  const cached = cacheDir && join(cacheDir, `${cacheName}.json`);
  if (cached && existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${API}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const text = await res.text();
      if (cached) writeFileSync(cached, text);
      await sleep(1000);
      return JSON.parse(text);
    } catch (err) {
      if (attempt === 4) throw new Error(`${path}: ${err.message}`);
      console.error(`retrying ${path} (${err.message})`);
      await sleep(5000 * attempt);
    }
  }
}

// Every page of a list endpoint, e.g. all(tracks, 500, "id:asc").
async function all(kind, perPage, sort) {
  const rows = [];
  for (let page = 1; ; page++) {
    const body = await get(`/${kind}?per_page=${perPage}&page=${page}&audio_status=any&sort=${sort}`, `${kind}-${String(page).padStart(3, "0")}`);
    rows.push(...body[kind]);
    console.log(`${kind}: page ${page} of ${body.total_pages}`);
    if (page >= body.total_pages) return rows;
  }
}

const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const text = (s) => (s ?? "").replace(/\r\n?/g, "\n").trim() || null;

const [rawShows, rawTracks, rawTours] = [await all("shows", 1000, "date:asc"), await all("tracks", 500, "id:asc"), await all("tours", 1000, "starts_on:asc")];

const tourSlug = new Map(rawTours.map((t) => [t.name, t.slug]));
const tours = Object.fromEntries(rawTours.map((t) => [t.slug, t.name]));

// Songs by slug. A track's own title is kept only where it differs from its
// song's (medleys such as "Weekapaug Groove > HYHU", or a variant name).
const songs = {};
const tracksByShow = new Map();
for (const t of rawTracks) {
  for (const s of t.songs) {
    songs[s.slug] ??= { name: s.title, ...(s.original ? {} : { artist: s.artist ?? null }) };
  }
  if (!tracksByShow.has(t.show_date)) tracksByShow.set(t.show_date, []);
  tracksByShow.get(t.show_date).push(t);
}

// Sorts phish.in's set names into playing order: "Soundcheck", "Pre-Show",
// "Set 1" to "Set 4", then "Encore", "Encore 2" and so on. Any other name
// sorts between the sets and the encores.
const setOrder = (name) => {
  const early = { Soundcheck: 0, "Pre-Show": 1 }[name];
  if (early !== undefined) return early;
  const [, kind, n = "1"] = name.match(/^(Set|Encore)(?: (\d+))?$/) ?? [];
  return kind ? (kind === "Encore" ? 100 : 10) + Number(n) : 50;
};

const tag = (g) => {
  const out = { tag: slugify(g.name) };
  const notes = text(g.notes) ?? text(g.transcript);
  if (notes) out.notes = notes;
  if (g.starts_at_second != null) out.at = g.starts_at_second;
  return out;
};

const shows = [];
const notesByYear = new Map();
for (const s of rawShows) {
  // In set order, so the notes' track numbers (below) follow the setlist.
  const tracks = (tracksByShow.get(s.date) ?? []).sort(
    (a, b) => setOrder(a.set_name) - setOrder(b.set_name) || a.position - b.position,
  );
  const sets = [];
  const trackNotes = {};
  tracks.forEach((t, i) => {
    let set = sets.at(-1);
    if (set?.label !== t.set_name) sets.push((set = { label: t.set_name, songs: [] }));
    // The song the title starts with leads; the rest are medley partners.
    const slugs = t.songs.map((x) => x.slug);
    const lead = t.songs.find((x) => t.title.startsWith(x.title))?.slug ?? slugs[0];
    const entry = { slug: lead };
    if (t.title !== songs[lead].name) entry.name = t.title;
    const also = slugs.filter((x) => x !== lead);
    if (also.length) entry.also = also;
    if (t.duration) entry.duration = Math.round(t.duration / 1000);
    if (t.exclude_from_stats) entry.noStats = true;
    const tags = [...new Set(t.tags.map((g) => slugify(g.name)))];
    if (tags.length) entry.tags = tags;
    set.songs.push(entry);
    // phish.in sometimes has a note twice, spelt two ways ("Black Eyed Katy",
    // "Black-Eyed Katy"); keep the first.
    const seen = new Set();
    const detailed = t.tags.map(tag).filter((g) => {
      const key = `${g.tag} ${(g.notes ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")} ${g.at}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return g.notes || g.at != null;
    });
    if (detailed.length) trackNotes[i] = detailed;
  });

  const { venue } = s;
  const us = venue.country === "USA" || venue.country === "US";
  const show = {
    id: s.date,
    date: s.date,
    venue: s.venue_name,
    venueId: venue.slug,
    city: venue.city,
    state: us ? venue.state : null,
    country: us ? "US" : venue.country,
    tour: tourSlug.get(s.tour_name) ?? null,
    audio: s.audio_status,
    // phish.in's generated cover, as its blob id; shows without audio only
    // have a shared placeholder, so they get none.
    cover: s.cover_art_model ? s.cover_art_urls.medium.match(/blob\/([^.]+)/)[1] : null,
    ...(s.duration ? { duration: Math.round(s.duration / 1000) } : {}),
    ...(s.tags.length ? { tags: [...new Set(s.tags.map((g) => slugify(g.name)))] } : {}),
    sets,
  };
  shows.push(show);

  const notes = {
    taper: text(s.taper_notes),
    admin: text(s.admin_notes),
    tags: s.tags.map(tag).filter((g) => g.notes),
    tracks: trackNotes,
  };
  // Every year with a show gets a file, even an empty one, so the app can
  // load any show's year without checking first.
  const year = s.date.slice(0, 4);
  if (!notesByYear.has(year)) notesByYear.set(year, {});
  if (notes.taper || notes.admin || notes.tags.length || Object.keys(notes.tracks).length) {
    notesByYear.get(year)[s.date] = notes;
  }
}
shows.sort((a, b) => a.id.localeCompare(b.id));

const root = new URL("../data/", import.meta.url);
const out = {
  source: {
    name: "phish.in",
    url: "https://phish.in",
    api: API,
    fetched: new Date().toISOString().slice(0, 10),
    code: "https://github.com/jcraigk/phishin",
  },
  tours,
  songs,
  shows,
};
writeFileSync(new URL("shows.json", root), JSON.stringify(out) + "\n");

const notesDir = new URL("notes/", root);
rmSync(notesDir, { recursive: true, force: true });
mkdirSync(notesDir, { recursive: true });
for (const [year, notes] of notesByYear) {
  writeFileSync(new URL(`${year}.json`, notesDir), JSON.stringify(notes) + "\n");
}
console.log(`wrote ${shows.length} shows, ${Object.keys(songs).length} songs and notes for ${notesByYear.size} years`);
