# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Phishbase is a Phish setlist browser, with show notes and photos: an Express 5 JSON API plus a
no-build vanilla-JS front end in `public/`. It is `~/dev/Deadbase` remade for Phish, and keeps
Deadbase's architecture, so most of what's true there is true here. The differences are the
data (below), the show page, and tags and tours in place of Deadbase's segues.

## Commands

```sh
npm install
npm run dev                          # http://localhost:3000 (PORT overrides), node --watch
npm test                             # node:test, all files in tests/
node --test tests/app.test.js        # one file
node --test --test-name-pattern="Hampton" tests/app.test.js   # one test
npm run import                       # refetch data/shows.json + data/notes/ from phish.in (~20 min)
npm run import -- --cache <dir>      # same, keeping/reusing the raw API pages in <dir>
npm run import:photos                # refetch data/photos.json from Wikimedia Commons (run after import)
npm run build                        # static GitHub Pages site into dist/
```

No linter, formatter, or build step. `node --check public/*.js` catches front-end syntax errors;
the tests only cover the API, so front-end changes need checking in a browser:

- Screenshots: `google-chrome --headless --window-size=1000,900 --virtual-time-budget=5000
  --screenshot=out.png "http://localhost:3000/#/show/1997-11-22"`. Add `--force-dark-mode
  --blink-settings=preferredColorScheme=0` for dark mode. Cover art and photos load from
  phish.in and upload.wikimedia.org, so screenshots need the network.
- Interactions: start Chrome with `--remote-debugging-port=9223` and drive it from a throwaway
  Node script (Node's built-in `WebSocket`, CDP `Input.dispatchMouseEvent` / `Runtime.evaluate`).
  If a script dies, kill its browser with `pkill -f 'remote-debugging-port=922[3]'`.

## Architecture

**Data pipeline.** Two importers write committed JSON; the app itself never fetches data.

- `scripts/import-phishin.js` pages through the [phish.in](https://phish.in) API v2 (open, no
  key; code MIT at github.com/jcraigk/phishin): every show, including those with no recording
  (`audio: "missing"`), and every track. It paces requests a second apart and retries, because
  phish.in asks API users to go easy; the tracks endpoint is slow (~15 s per page of 500, and a
  page occasionally times out). It writes `data/shows.json` (shows, setlists, tours, songs) and
  `data/notes/YYYY.json` (every note: taper notes, and the notes on show and song tags), one
  file per year that has shows, even if empty.
- `scripts/import-photos.js` reads the Commons categories `Phish` (plus its `Phish …`
  subcategories) and `Trey Anastasio`, and keeps only files matched by its `SERIES` rules, each a
  title pattern and the show ids it belongs to. The rules are curated by hand because Commons'
  dates are unreliable (EXIF dates off by weeks or years; the Sphere series is titled with a
  date Phish didn't play). A rule naming several shows means the night isn't known, and the show
  page says so. The importer fails if a rule names a show that isn't in `data/shows.json`. New
  photos on Commons need a new rule.

Show ids are the ISO date (phish.in has at most one show per date). Ids sort chronologically,
and the order of everything else depends on that. Setlist entries keep only what differs from
the song table: `name` only when the track's title isn't its song's (medleys like "Weekapaug
Groove > HYHU"), `also` for a medley's other songs, `noStats` for soundcheck songs, and `tags`
as slugs. The notes files hold the text for those tags, keyed by the entry's position in the
show's flattened setlist, so the importer writes both from the same set-ordered track list.

**`src/data.js` is the whole model.** At import time it loads `shows.json` and `photos.json`
once and enriches them in place (`year`, `songCount`, song names), and builds `showsById`,
`songsBySlug` (per-song show ids, including medley partners, deduped so a reprise counts once)
and `photosByShow`. `getShow` is the one async function: it `import()`s the show's year of
notes on first use and merges them in. Everything else is synchronous and in memory.

- **Song identity is phish.in's song slug.** Covers carry their original `artist`.
- **Venue identity is phish.in's venue slug** (`venueId`); `venue` is the name the venue had at
  that show, so renamed venues still group together. The `venue` filter takes the slug.
- **Encores and set numbers come from phish.in**, including "Soundcheck" and "Encore 2";
  there's no heuristic.
- **phish.in has no segues** between tracks, so Deadbase's segue filter, chart and record are
  gone. In their place: the `tag` filter, the Jam Charts and "Show features" panels, and the
  longest-song record. `TAGS` maps tag slugs to display names.
- `SEGMENTS` (jams, banter, narration, intros…) and `noStats` entries (soundchecks) are left
  out of stats rankings but still appear in setlists and song pages.

`/api/shows`, `/api/years` and `/api/stats` share one set of filters (`filterShows`; `filters()`
in api.js picks them from the query): `year`, `from`/`to` (inclusive ISO date prefixes),
`song`, `tag` (on the show or any of its songs; with `song`, on that song), `tour`, `venue`,
`city`, `state`, `country`, `q`. Non-US shows have `state: null`; `country` is `"US"` for the
US. README.md has the API table.

`src/api.js` is the API's routing over `data.js`, as `async handle(path, query)` returning
`{ status, body }`, with no Express in it. `src/app.js` sends every `/api` request to it, serves
`public/` statically, and exports `app` without listening (`src/index.js` listens). `data.js`
loads JSON with `import ... with { type: "json" }` (and `import()` for notes), not `fs`, so both
modules also run in a browser.

**GitHub Pages** has no server, so the static build runs the API in the browser.
`scripts/build-pages.js` copies `public/` to `dist/`, replaces `public/api.js` with
`static/api.js` (which awaits `handle` directly), and adds `src/api.js`, `src/data.js`,
`data/shows.json`, `data/photos.json` and `data/notes/` at the same relative paths. Keep the
front end's `api/...` paths relative, because the site would be served from `/Phishbase/`.
`.github/workflows/pages.yml` tests, builds and deploys on every push to `main`.

**Front end** is native ES modules, no bundler. Same shape as Deadbase:

- `public/main.js` is a hash router: `#/`, `#/year/Y`, `#/show/ID`, `#/tours`, `#/songs`,
  `#/song/SLUG`, `#/search?q=`, `#/stats?<place>&from=&to=`, and `#/shows?<any /api/shows
  filter>`. Each route returns an HTML string for `#view`; a newer navigation replaces a slower
  one. Every interpolated value must go through `esc()`.
- `public/show.js` is the show page: facts and cover art, the sets with lengths, tag chips and
  tag notes under each song, show notes, the photo gallery (with credits, grouped by exact night
  vs. run), and taper notes in a `<details>`. Tags about the recording (`RECORDING`: SBD,
  remaster, cut) go on the recording line, not on songs.
- `public/lib.js`: `esc`, `api`, date and duration formatting, `tagNames()` (fetched once),
  `pageTitle` (the donut logo, `public/logo.svg`, shown in its own red and blue as a CSS
  background, and also the favicon; its comment says how it was traced), `sortableTable`, `showList` (runs keyed on `venueId`, photo counts, the
  per-period overview chart, `setlists` with a ★ on Jam Charts picks), `inlineBar`.
- `public/stats.js`: as Deadbase's, scoped by `{ site, from, to }` where `site.venue` is a venue
  id. `ERAS` holds Phish 1.0–4.0 as exact first and last show dates (4.0 is open-ended).
  `wireStats(view)` provides the `[data-tip]` tooltip for every page, and the in-page jumps:
  a `button[data-jump="<selector>"]` scrolls to that element. Never use an `href="#id"`
  anchor for this, as the hash router would treat it as a route.

**Colours** are Deadbase's tokens in `styles.css`, unchanged: `--seq-1..5` is one blue ramp,
flipped for dark mode; `--bar`/`--bar-dim` were contrast-checked together, so change them as a
set.

## Repo notes

- Remote is `git@github-forest734:Forest734/Phishbase.git` (the Forest734 SSH alias, not
  `github.com`). Branch `main`.
- Pushing to `main` runs the Pages workflow; it deploys only once the repository's Settings →
  Pages → Source is set to GitHub Actions, and would then serve https://forest734.github.io/Phishbase/.
- `CHANGELOG.md` (Keep a Changelog): record each user-visible change under
  `## [Unreleased]` in the commit that makes it. When cutting a release, rename that heading
  to the version and date, and bump `package.json` and `VERSION` in `src/api.js`.
- Credits are a licence condition, not decoration: every photo shows its author and licence
  (CC BY / BY-SA), and the footer credits phish.in, Phish.net (Jam Charts notes) and Commons.
