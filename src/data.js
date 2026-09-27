// Built by scripts/import-phishin.js and scripts/import-photos.js; shows are
// sorted by id, which sorts by date. Imported rather than read from disk, so
// this module also runs in the browser for the GitHub Pages build (see
// src/api.js). Each show's notes are in data/notes/YYYY.json, which only
// getShow loads, so lists and stats never pay for them.
import data from "../data/shows.json" with { type: "json" };
import photoData from "../data/photos.json" with { type: "json" };

const { tours, songs: songTable, shows } = data;

export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// phish.in's tags, by slug, as they read on a page. "Jamcharts" is Phish.net's
// Jam Charts, its community's list of standout versions.
export const TAGS = {
  "a-cappella": "A Cappella",
  acoustic: "Acoustic",
  "alt-lyric": "Alt Lyric",
  "alt-rig": "Alt Rig",
  "alt-version": "Alt Version",
  audience: "Audience",
  banter: "Banter",
  bustout: "Bustout",
  costume: "Costume",
  cut: "Cut",
  debut: "Debut",
  gamehendge: "Gamehendge",
  guest: "Guest",
  jamcharts: "Jam Charts",
  lore: "Lore",
  narration: "Narration",
  rmstr: "Remaster",
  sbd: "Soundboard",
  signal: "Signal",
  tease: "Tease",
  unfinished: "Unfinished",
  weather: "Weather",
};

const showsById = new Map();
const songsBySlug = new Map();
const photosByShow = new Map();

for (const photo of photoData.photos) {
  for (const id of photo.shows) {
    if (!photosByShow.has(id)) photosByShow.set(id, []);
    photosByShow.get(id).push(photo);
  }
}

for (const show of shows) {
  show.year = Number(show.date.slice(0, 4));
  show.tags ??= [];
  for (const set of show.sets) {
    for (const song of set.songs) {
      song.name ??= songTable[song.slug].name;
      song.tags ??= [];
    }
  }
  show.songCount = show.sets.reduce((n, set) => n + set.songs.length, 0);
  showsById.set(show.id, show);

  for (const set of show.sets) {
    for (const song of set.songs) {
      for (const slug of [song.slug, ...(song.also ?? [])]) {
        let entry = songsBySlug.get(slug);
        if (!entry) {
          const { name, artist } = songTable[slug];
          entry = { slug, name, artist, showIds: [] };
          songsBySlug.set(slug, entry);
        }
        // A song played twice in one show (a reprise) is still one show.
        if (entry.showIds.at(-1) !== show.id) entry.showIds.push(show.id);
      }
    }
  }
}

// Every setlist entry of a show, with its set.
const entries = (show) => show.sets.flatMap((set) => set.songs.map((song) => ({ set, song })));
const playsSong = (song, slug) => song.slug === slug || song.also?.includes(slug);

export function summary(show) {
  const { id, date, year, venue, venueId, city, state, country, tour, audio, songCount } = show;
  return { id, date, year, venue, venueId, city, state, country, tour, audio, songCount, photos: photosByShow.get(id)?.length ?? 0 };
}

export function getSource() {
  return { setlists: data.source, photos: photoData.source };
}

// phish.in's bucket for one-off shows (TV spots, benefits) across the whole
// career; it isn't a tour, so it goes after the real ones.
const NO_TOUR = "not-part-of-a-tour";

// Tours with their show count and first and last dates, in date order.
export function getTours() {
  const byTour = new Map();
  for (const show of shows) {
    if (!show.tour) continue;
    if (!byTour.has(show.tour)) byTour.set(show.tour, []);
    byTour.get(show.tour).push(show.date);
  }
  return [...byTour]
    .map(([slug, dates]) => ({ slug, name: tours[slug], count: dates.length, first: dates[0], last: dates.at(-1) }))
    .sort((a, b) => (a.slug === NO_TOUR) - (b.slug === NO_TOUR));
}

export const tourName = (slug) => tours[slug] ?? null;

// Shows per year for every year of the band's career, including years with
// none that match the filters (see filterShows). `months` counts shows per
// calendar month, January first.
export function getYears(filters) {
  const years = new Map();
  for (let year = shows[0].year; year <= shows.at(-1).year; year++) {
    years.set(year, { year, count: 0, months: Array(12).fill(0) });
  }
  for (const show of filterShows(filters)) {
    const y = years.get(show.year);
    y.count++;
    y.months[Number(show.date.slice(5, 7)) - 1]++;
  }
  return [...years.values()];
}

// `from` and `to` are inclusive ISO date prefixes: "1997", "1997-11" or "1997-11-22".
function inRange(date, from, to) {
  return (!from || date >= from) && (!to || date <= `${to}￿`);
}

// True if the show has the tag, on the show itself or on one of its songs.
// With a song, the tag must be on that song (a jam-charted Tweezer, say).
function hasTag(show, tag, song) {
  if (!song && show.tags.includes(tag)) return true;
  return entries(show).some(({ song: s }) => s.tags.includes(tag) && (!song || playsSong(s, song)));
}

// Filters combine: year, from/to date range, song slug, tag slug, tour slug,
// venue id, exact city/state/country, and free text over the date and place.
function filterShows({ year, from, to, song, tag, tour, venue, city, state, country, q } = {}) {
  let result = shows;
  if (year) result = result.filter((s) => s.year === Number(year));
  if (from || to) result = result.filter((s) => inRange(s.date, from, to));
  if (song) {
    const ids = new Set(songsBySlug.get(song)?.showIds ?? []);
    result = result.filter((s) => ids.has(s.id));
  }
  if (tag) result = result.filter((s) => hasTag(s, tag, song));
  if (tour) result = result.filter((s) => s.tour === tour);
  if (venue) result = result.filter((s) => s.venueId === venue);
  for (const [field, value] of Object.entries({ city, state, country })) {
    if (value) result = result.filter((s) => s[field] === value);
  }
  if (q) {
    const needle = q.trim().toLowerCase();
    result = result.filter((s) =>
      [s.date, s.venue, s.city, s.state, s.country, tours[s.tour]].some((f) => f?.toLowerCase().includes(needle)),
    );
  }
  return result;
}

// The setlist as lists and pages show it: each song's name, slug and tags.
const setlist = (show) =>
  show.sets.map((set) => ({
    label: set.label,
    songs: set.songs.map(({ name, slug, tags }) => ({ name, slug, tags })),
  }));

// With `sets`, each summary also carries the show's setlist.
export function findShows(filters, { sets = false } = {}) {
  return filterShows(filters).map((show) => (sets ? { ...summary(show), sets: setlist(show) } : summary(show)));
}

// One year's notes, loaded the first time a show from that year is asked for.
async function notesFor(year) {
  const { default: notes } = await import(`../data/notes/${year}.json`, { with: { type: "json" } });
  return notes;
}

// Everything about one show: its setlist with each song's length, tags and
// the notes on them, the show's own tags and notes, taper notes, cover art
// and photos, and the ids of the shows either side.
export async function getShow(id) {
  const show = showsById.get(id);
  if (!show) return undefined;
  const notes = (await notesFor(show.year))[id] ?? { tracks: {}, tags: [] };
  const i = shows.indexOf(show);
  let n = 0;
  const sets = show.sets.map((set) => ({
    label: set.label,
    songs: set.songs.map((song) => {
      const { name, slug, also = [], duration = null, tags } = song;
      const tagNotes = notes.tracks[n++] ?? [];
      return { name, slug, also: also.map((s) => ({ slug: s, name: songTable[s].name })), duration, tags, notes: tagNotes };
    }),
  }));
  return {
    ...summary(show),
    tourName: tourName(show.tour),
    duration: show.duration ?? null,
    cover: show.cover && `https://phish.in/blob/${show.cover}.jpg`,
    listen: show.audio === "missing" ? null : `https://phish.in/${show.date}`,
    tags: show.tags,
    tagNotes: notes.tags,
    notes: notes.admin ?? null,
    taperNotes: notes.taper ?? null,
    gallery: (photosByShow.get(id) ?? []).map(({ shows: run, ...photo }) => ({ ...photo, run })),
    sets,
    prev: shows[i - 1]?.id ?? null,
    next: shows[i + 1]?.id ?? null,
  };
}

export function getSongs() {
  return [...songsBySlug.values()]
    .map(({ slug, name, artist, showIds }) => ({
      slug,
      name,
      artist: artist ?? null,
      count: showIds.length,
      first: showIds[0],
      last: showIds.at(-1),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getSong(slug) {
  const entry = songsBySlug.get(slug);
  if (!entry) return undefined;
  const jamcharts = entry.showIds.filter((id) => hasTag(showsById.get(id), "jamcharts", slug)).length;
  return {
    slug,
    name: entry.name,
    artist: entry.artist ?? null,
    count: entry.showIds.length,
    jamcharts,
    shows: entry.showIds.map((id) => summary(showsById.get(id))),
  };
}

// Setlist entries that are parts of a show rather than songs. They would top
// or clutter every ranking, so the stats leave them out.
const SEGMENTS = new Set(["jam", "banter", "narration", "intro", "outro", "soundcheck", "interview", "drums"]);
// phish.in marks soundcheck songs noStats; they aren't part of the show.
const counted = (song) => !song.noStats && !SEGMENTS.has(song.slug);

// Each show's position among the shows with a setlist, for "shows since last played".
const setlistIndex = new Map(shows.filter((s) => s.sets.length).map((s, i) => [s.id, i]));

const tally = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
// The n biggest counts. Ties keep first-seen, which is chronological, order.
const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n);
const songRef = (slug) => ({ slug, name: songsBySlug.get(slug).name });
const ranked = ([slug, shows]) => ({ ...songRef(slug), shows });

// The tags the stats count shows for: things about the playing, not the recording.
const FEATURES = ["jamcharts", "debut", "bustout", "guest", "tease", "signal", "costume", "gamehendge", "acoustic", "a-cappella"];

// Aggregates over the shows that match the filters (see filterShows).
export function getStats(filters) {
  const scoped = filterShows(filters);
  const inScope = new Set(scoped.map((s) => s.id));
  const played = scoped.filter((s) => s.sets.length);

  // Rotation columns are years, or months when the range sits inside one year.
  const byMonth = scoped.length > 0 && scoped[0].year === scoped.at(-1).year;
  const bucketOf = (s) => (byMonth ? s.date.slice(0, 7) : String(s.year));

  const songShows = new Map();
  const songBuckets = new Map(); // "slug bucket" -> shows
  const bucketShows = new Map();
  const openers = new Map();
  const setTwoOpeners = new Map();
  const encores = new Map();
  const jamcharts = new Map(); // slug -> shows where that song made Jam Charts
  const features = new Map(); // tag -> shows
  let songEntries = 0;
  let longestSetlist = null;
  let longestSong = null;

  for (const show of played) {
    const bucket = bucketOf(show);
    tally(bucketShows, bucket);
    const songs = show.sets.flatMap((set) => set.songs);
    songEntries += songs.length;
    if (songs.length > (longestSetlist?.songCount ?? 0)) longestSetlist = summary(show);

    for (const slug of new Set(songs.filter(counted).flatMap((s) => [s.slug, ...(s.also ?? [])]))) {
      tally(songShows, slug);
      tally(songBuckets, `${slug} ${bucket}`);
    }
    const first = show.sets.find((set) => set.label.startsWith("Set"))?.songs.find(counted);
    if (first) tally(openers, first.slug);
    const second = show.sets.find((set) => set.label === "Set 2")?.songs.find(counted);
    if (second) tally(setTwoOpeners, second.slug);
    const encoreSongs = show.sets.filter((set) => set.label.startsWith("Encore")).flatMap((set) => set.songs);
    for (const slug of new Set(encoreSongs.filter(counted).map((s) => s.slug))) tally(encores, slug);

    for (const slug of new Set(songs.filter((s) => s.tags.includes("jamcharts") && counted(s)).map((s) => s.slug))) {
      tally(jamcharts, slug);
    }
    const tags = new Set([...show.tags, ...songs.flatMap((s) => s.tags)]);
    for (const tag of FEATURES) if (tags.has(tag)) tally(features, tag);

    for (const song of songs) {
      if (counted(song) && (song.duration ?? 0) > (longestSong?.duration ?? 0)) {
        longestSong = { ...summary(show), song: { slug: song.slug, name: song.name }, duration: song.duration };
      }
    }
  }

  // Each year (or month) with a show in scope, including shows without setlists.
  const buckets = [...new Set(scoped.map(bucketOf))];

  const catalog = [...songsBySlug.values()].filter((e) => !SEGMENTS.has(e.slug));
  let bustout = null;
  for (const { slug, name, showIds } of catalog) {
    for (let i = 1; i < showIds.length; i++) {
      if (!inScope.has(showIds[i])) continue;
      const gap = setlistIndex.get(showIds[i]) - setlistIndex.get(showIds[i - 1]) - 1;
      if (gap > (bustout?.gap ?? 0)) {
        bustout = { slug, name, gap, prev: showIds[i - 1], show: summary(showsById.get(showIds[i])) };
      }
    }
  }

  const venues = new Map(); // venue id -> shows
  const venueShow = new Map(); // venue id -> its latest show in scope, for the name
  const states = new Map();
  const countries = new Map();
  for (const show of scoped) {
    tally(venues, show.venueId);
    venueShow.set(show.venueId, show);
    tally(show.country === "US" ? states : countries, show.country === "US" ? show.state : show.country);
  }

  // A run is consecutive shows at one venue in the band's whole history (so a
  // venue's own stats don't count all its shows as one run); only shows in
  // scope count towards it.
  let venueRun = null;
  let run = [];
  shows.forEach((show, i) => {
    if (inScope.has(show.id)) run.push(show);
    if (shows[i + 1]?.venueId === show.venueId) return;
    if (run.length > (venueRun?.shows ?? 1)) {
      const { venue, venueId, city, state, country } = run.at(-1);
      venueRun = { venue, venueId, city, state, country, shows: run.length, first: run[0].date, last: run.at(-1).date };
    }
    run = [];
  });

  return {
    first: scoped[0]?.date ?? null,
    last: scoped.at(-1)?.date ?? null,
    totals: {
      shows: scoped.length,
      setlists: played.length,
      songs: songShows.size,
      debuts: catalog.filter((e) => inScope.has(e.showIds[0])).length,
      venues: venues.size,
      years: new Set(scoped.map((s) => s.year)).size,
      songsPerShow: played.length ? Math.round((songEntries / played.length) * 10) / 10 : 0,
    },
    rotation: {
      buckets: buckets.map((key) => ({ key, shows: bucketShows.get(key) ?? 0 })),
      songs: top(songShows, 20).map(([slug, n]) => ({
        ...songRef(slug),
        shows: n,
        cells: buckets.map((b) => songBuckets.get(`${slug} ${b}`) ?? 0),
      })),
    },
    jamcharts: top(jamcharts, 10).map(ranked),
    features: top(features, Infinity).map(([tag, n]) => ({ tag, name: TAGS[tag], shows: n })),
    openers: top(openers, 8).map(ranked),
    setTwoOpeners: top(setTwoOpeners, 8).map(ranked),
    encores: top(encores, 8).map(ranked),
    venues: top(venues, 10).map(([id, n]) => {
      const { venue, venueId, city, state, country } = venueShow.get(id);
      return { venue, venueId, city, state, country, shows: n };
    }),
    states: [...states].map(([state, n]) => ({ state, shows: n })),
    countries: top(countries, Infinity).map(([country, n]) => ({ country, shows: n })),
    records: { longestSetlist, longestSong, bustout, venueRun },
  };
}
