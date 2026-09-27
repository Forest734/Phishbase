import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
import { handle } from "../src/api.js";

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

const get = async (path) => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text() };
};

test("health check", async () => {
  const { status, body } = await get("/health");
  assert.equal(status, 200);
  assert.deepEqual(body, { status: "ok" });
});

test("serves the frontend", async () => {
  const { status, body } = await get("/");
  assert.equal(status, 200);
  assert.match(body, /<h1>Phishbase<\/h1>/);
});

test("years span the band's career, hiatus years included", async () => {
  const { body } = await get("/api/years");
  assert.equal(body[0].year, 1983);
  assert.ok(body.at(-1).year >= 2026);
  assert.ok(body.reduce((n, y) => n + y.count, 0) > 2100);
  assert.equal(body.find((y) => y.year === 2006).count, 0);
});

test("Hampton '97: sets, lengths, tags and their notes", async () => {
  const { status, body } = await get("/api/shows/1997-11-22");
  assert.equal(status, 200);
  assert.equal(body.venue, "Hampton Coliseum");
  assert.equal(body.venueId, "hampton-coliseum");
  assert.equal(body.state, "VA");
  assert.equal(body.country, "US");
  assert.equal(body.tour, "fall-tour-1997");
  assert.deepEqual(body.sets.map((s) => s.label), ["Set 1", "Set 2", "Encore"]);
  const mikes = body.sets[0].songs[0];
  assert.equal(mikes.name, "Mike's Song");
  assert.equal(mikes.slug, "mike-s-song");
  assert.ok(mikes.duration > 900);
  assert.ok(mikes.tags.includes("jamcharts"));
  assert.ok(mikes.notes.some((n) => n.tag === "jamcharts" && n.notes.length > 50));
  assert.match(body.taperNotes, /Schoeps/);
  assert.match(body.cover, /^https:\/\/phish\.in\/blob\/\w+\.jpg$/);
  assert.equal(body.listen, "https://phish.in/1997-11-22");
  assert.equal(body.prev, "1997-11-21");
  assert.equal(body.next, "1997-11-23");
});

test("a show without a recording has its setlist but no cover or link", async () => {
  const { body } = await get("/api/shows?year=2025");
  const missing = body.find((s) => s.audio === "missing");
  const show = (await get(`/api/shows/${missing.id}`)).body;
  assert.ok(show.sets.length > 0);
  assert.equal(show.cover, null);
  assert.equal(show.listen, null);
});

test("unknown show is a 404", async () => {
  assert.equal((await get("/api/shows/1999-01-01")).status, 404);
});

test("filters shows by year, song and text", async () => {
  const y97 = (await get("/api/shows?year=1997")).body;
  assert.ok(y97.length > 50 && y97.every((s) => s.year === 1997));

  const hampton = (await get("/api/shows?q=hampton")).body;
  assert.ok(hampton.some((s) => s.id === "1997-11-22"));

  const yem97 = (await get("/api/shows?year=1997&song=you-enjoy-myself")).body;
  assert.ok(yem97.length > 10 && yem97.every((s) => s.year === 1997));
});

test("filters by tour, venue and tag, and a tag with a song means that song", async () => {
  const fall97 = (await get("/api/shows?tour=fall-tour-1997")).body;
  assert.ok(fall97.some((s) => s.id === "1997-11-22") && fall97.every((s) => s.tour === "fall-tour-1997"));

  const hampton = (await get("/api/shows?venue=hampton-coliseum")).body;
  assert.ok(hampton.length > 20 && hampton.every((s) => s.venueId === "hampton-coliseum"));

  const gamehendge = (await get("/api/shows?tag=gamehendge")).body;
  assert.ok(gamehendge.some((s) => s.id === "1994-06-26"));

  const tweezers = (await get("/api/shows?song=tweezer")).body;
  const jammed = (await get("/api/shows?song=tweezer&tag=jamcharts")).body;
  assert.ok(jammed.length > 20 && jammed.length < tweezers.length);
  for (const { id } of jammed.slice(0, 5)) {
    const show = (await get(`/api/shows/${id}`)).body;
    const songs = show.sets.flatMap((s) => s.songs);
    assert.ok(songs.some((s) => s.slug === "tweezer" && s.tags.includes("jamcharts")));
  }
});

test("show lists carry setlists only when asked", async () => {
  const plain = (await get("/api/shows?year=1997")).body;
  assert.ok(plain.every((s) => !("sets" in s)));

  const withSets = (await get("/api/shows?year=1997&sets=1")).body;
  assert.equal(withSets.length, plain.length);
  const hampton = withSets.find((s) => s.id === "1997-11-22");
  const full = (await get("/api/shows/1997-11-22")).body;
  assert.deepEqual(
    hampton.sets.map((s) => s.songs.map((x) => x.slug)),
    full.sets.map((s) => s.songs.map((x) => x.slug)),
  );
});

test("song index and song detail", async () => {
  const songs = (await get("/api/songs")).body;
  const yem = songs.find((s) => s.slug === "you-enjoy-myself");
  assert.ok(yem.count > 500);
  assert.equal(yem.artist, null);
  assert.equal(songs.find((s) => s.slug === "crosseyed-and-painless").artist, "Talking Heads");

  const { body } = await get("/api/songs/tweezer");
  assert.equal(body.name, "Tweezer");
  assert.equal(body.shows.length, body.count);
  assert.ok(body.jamcharts > 20);
  assert.equal((await get("/api/songs/no-such-song")).status, 404);
});

test("tours are in date order with their shows counted, one-offs last", async () => {
  const tours = (await get("/api/tours")).body;
  const fall97 = tours.find((t) => t.slug === "fall-tour-1997");
  assert.equal(fall97.count, (await get("/api/shows?tour=fall-tour-1997")).body.length);
  assert.equal(tours.at(-1).slug, "not-part-of-a-tour");
  const real = tours.slice(0, -1);
  for (let i = 1; i < real.length; i++) assert.ok(real[i - 1].first <= real[i].first);
});

test("photos: a show's own, and a run's where the night isn't known", async () => {
  const mci = (await get("/api/shows/1999-12-15")).body;
  assert.ok(mci.photos > 5 && mci.gallery.length === mci.photos);
  for (const p of mci.gallery) {
    assert.deepEqual(p.run, ["1999-12-15"]);
    assert.match(p.thumb, /^https:\/\/(thumb|upload)\.wikimedia\.org\/[^?]+$/);
    assert.ok(p.author && p.license);
  }
  const sphere = (await get("/api/shows/2024-04-19")).body;
  assert.ok(sphere.gallery.some((p) => p.run.length === 4));
  assert.equal((await get("/api/shows/1997-11-22")).body.gallery.length, 0);
});

test("years include per-month counts", async () => {
  const { body } = await get("/api/years");
  for (const y of body) {
    assert.equal(y.months.length, 12);
    assert.equal(y.months.reduce((a, b) => a + b, 0), y.count);
  }
});

test("stats for the whole career", async () => {
  const { status, body } = await get("/api/stats");
  assert.equal(status, 200);
  assert.equal(body.first, "1983-12-02");
  assert.ok(body.totals.shows > 2100);
  // Jams and banter are parts of a show, not songs, so they stay out of the rankings.
  assert.ok(!body.rotation.songs.some((s) => s.slug === "jam" || s.slug === "banter"));
  assert.equal(body.rotation.songs[0].slug, "you-enjoy-myself");
  assert.ok(body.jamcharts.length === 10 && body.jamcharts[0].shows > 50);
  assert.equal(body.features[0].tag, "jamcharts");
  assert.ok(body.states.find((s) => s.state === "VT").shows > 200);
  assert.ok(body.countries.some((c) => c.country === "Mexico"));
  assert.ok(body.records.longestSong.duration > 30 * 60);
});

test("stats for one year use months, and an empty range is empty", async () => {
  const { body } = await get("/api/stats?from=1997&to=1997");
  assert.equal(body.totals.shows, (await get("/api/shows?year=1997")).body.length);
  assert.equal(body.rotation.buckets[0].key.slice(0, 4), "1997");
  // Every rotation cell is a subset of the shows counted in its bucket.
  for (const song of body.rotation.songs) {
    song.cells.forEach((n, i) => assert.ok(n <= body.rotation.buckets[i].shows));
  }
  const none = (await get("/api/stats?from=2006&to=2007")).body;
  assert.equal(none.totals.shows, 0);
  assert.deepEqual(none.rotation, { buckets: [], songs: [] });
  assert.equal(none.records.longestSetlist, null);
});

test("years and stats take the same filters as shows", async () => {
  const msg = "venue=madison-square-garden";
  const shows = (await get(`/api/shows?${msg}`)).body;
  const years = (await get(`/api/years?${msg}`)).body;
  // Every year of the career, with zeros, so charts line up.
  assert.equal(years.length, (await get("/api/years")).body.length);
  assert.equal(years.reduce((n, y) => n + y.count, 0), shows.length);

  const stats = (await get(`/api/stats?${msg}`)).body;
  assert.equal(stats.totals.shows, shows.length);
  assert.equal(stats.totals.venues, 1);
  // A run counts consecutive shows in the band's history, not consecutive
  // shows in the filtered list: the Baker's Dozen was 13 straight nights.
  assert.equal(stats.records.venueRun.shows, 13);
  assert.equal(stats.records.venueRun.first, "2017-07-21");

  const vt10 = (await get("/api/stats?state=VT&from=1983&to=2000-10-07")).body;
  const vt10Shows = (await get("/api/shows?state=VT&from=1983&to=2000-10-07")).body;
  assert.equal(vt10.totals.shows, vt10Shows.length);
  assert.deepEqual(vt10.states.map((s) => s.state), ["VT"]);
});

test("the API answers the same without the server, as on GitHub Pages", async () => {
  for (const path of ["shows/1997-11-22", "songs/tweezer", "shows?year=1997&sets=1", "stats?state=VT&from=1990", "tours"]) {
    const [route, query = ""] = path.split("?");
    const direct = await handle(route, Object.fromEntries(new URLSearchParams(query)));
    assert.equal(direct.status, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(direct.body)), (await get(`/api/${path}`)).body);
  }
  assert.equal((await handle("shows/1999-01-01")).status, 404);
  assert.equal((await handle("nope")).status, 404);
  assert.equal((await get("/api/nope")).status, 404);
});
