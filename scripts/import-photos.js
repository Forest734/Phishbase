// Fetches concert photos of Phish from Wikimedia Commons and writes
// data/photos.json: for each photo, the show (or run of shows) it was taken
// at, a thumbnail, and the author and licence that must be credited.
//
//   npm run import:photos        # run after npm run import; ~10 requests
//
// Photos are matched to shows by the rules in SERIES, not by their EXIF
// dates, which are often wrong (the Lemonwheel scans say 1998-08-01, another
// show's date). Each rule names a file-title pattern and the show or shows it
// belongs to. Where the night isn't known (a festival, a residency), the rule
// names the whole run, and the show page says so. Files that match no rule,
// such as solo shows, portraits and promo shots, are left out.
import { readFileSync, writeFileSync } from "node:fs";

const API = "https://commons.wikimedia.org/w/api.php";
const HEADERS = { "User-Agent": "Phishbase importer (https://github.com/Forest734/Phishbase)" };
const CATEGORIES = ["Category:Phish", "Category:Trey Anastasio"];

// [title pattern, show ids]. Titles are the Commons file names, without "File:".
const SERIES = [
  [/^Lemonwheel/, ["1998-08-14", "1998-08-15", "1998-08-16"]],
  [/^Phish 12\.15\.99/, ["1999-12-15"]],
  [/^Phishdog\./, ["1999-12-31"]],
  [/^Phish NY2k mascot\./, ["1999-12-29", "1999-12-30", "1999-12-31"]],
  [/^CK5 rocking the light board\.|^Jon&Trey\./, ["2003-07-13"]],
  [/^(Mike-Gordon|Page-McConnell|Trey-Anastasio 2009)\.jpg$/, ["2009-07-30"]],
  [/^Phish Festival 8\./, ["2009-10-29", "2009-10-30", "2009-10-31", "2009-11-01"]],
  [/^Trey-Anastasio2009 2\./, ["2009-11-01"]],
  [/^Jon-Fishman2009-12-28\./, ["2009-12-28"]],
  [/^Phish 2009-12-30\.|^Phish Miami 2009 12 30\./, ["2009-12-30"]],
  [/^Phish Hartford/, ["2010-06-18"]],
  [/^Phish MSG New Years Balloon Drop/, ["2011-12-31"]],
  [/^Phish - Eugene/, ["2014-10-17"]],
  [/^Seattle Phish 10 18 14/, ["2014-10-18"]],
  [/^Phish - Chula Vista 10 25 14/, ["2014-10-25"]],
  [/^Phish Dicks 2015/, ["2015-09-04", "2015-09-05", "2015-09-06"]],
  [/^Phish Tour - St\.Paul - 6 22 16/, ["2016-06-22"]],
  [/^Phish Tour - Wrigley Field - ?6-24/, ["2016-06-24"]],
  [/^Phish Tour - Wrigley Field - ?6-25/, ["2016-06-25"]],
  [/^Phish Tour - SPAC - 7 01/, ["2016-07-01"]],
  [/^Phish Tour - Portland - 7 6 16/, ["2016-07-06"]],
  [/^Phish Tour - Syracuse/, ["2016-07-10"]],
  [/^Phish Dick’s Sporting Goods Park 09\.01\.19/, ["2019-09-01"]],
  [/^Phish Live at Sphere imagery on exosphere on April 20 2024/, ["2024-04-20"]],
  // Titled "April 30", which wasn't a show; the four-night run was April 18–21.
  [/^Phish at Sphere on April 30 2024/, ["2024-04-18", "2024-04-19", "2024-04-20", "2024-04-21"]],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function query(params) {
  const body = new URLSearchParams({ ...params, format: "json", formatversion: "2" });
  const res = await fetch(API, { method: "POST", body, headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  await sleep(500);
  return res.json();
}

// File titles in a category, without descending into subcategories that are
// about something else (HeadCount's voter-registration tables, for one).
async function filesIn(category, seen = new Set()) {
  if (seen.has(category)) return [];
  seen.add(category);
  const files = [];
  let cont;
  do {
    const d = await query({ action: "query", list: "categorymembers", cmtitle: category, cmlimit: "500", cmtype: "file|subcat", ...(cont && { cmcontinue: cont }) });
    for (const m of d.query.categorymembers) {
      if (m.ns === 6) files.push(m.title);
      else if (/^Category:Phish /.test(m.title)) files.push(...(await filesIn(m.title, seen)));
    }
    cont = d.continue?.cmcontinue;
  } while (cont);
  return files;
}

// Commons' metadata fields are HTML; the page shows them as text.
const plain = (html) =>
  (html ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const { shows } = JSON.parse(readFileSync(new URL("../data/shows.json", import.meta.url), "utf8"));
const showIds = new Set(shows.map((s) => s.id));
for (const [pattern, ids] of SERIES) {
  for (const id of ids) if (!showIds.has(id)) throw new Error(`${pattern}: no show ${id} in data/shows.json`);
}

const titles = [...new Set((await Promise.all(CATEGORIES.map((c) => filesIn(c)))).flat())]
  .filter((t) => SERIES.some(([pattern]) => pattern.test(t.slice(5))))
  .sort();

const photos = [];
for (let i = 0; i < titles.length; i += 50) {
  const d = await query({
    action: "query",
    titles: titles.slice(i, i + 50).join("|"),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlwidth: "480",
  });
  for (const page of d.query.pages) {
    const info = page.imageinfo[0];
    const meta = (key) => plain(info.extmetadata?.[key]?.value);
    const name = page.title.slice(5);
    photos.push({
      title: name.replace(/\.[a-z]+$/i, ""),
      shows: SERIES.find(([pattern]) => pattern.test(name))[1],
      page: info.descriptionurl,
      thumb: info.thumburl.split("?")[0], // without Commons' utm_ tracking parameters
      width: info.thumbwidth,
      height: info.thumbheight,
      author: meta("Artist") || "Unknown",
      license: meta("LicenseShortName"),
      licenseUrl: meta("LicenseUrl") || null,
      description: meta("ImageDescription") || null,
    });
  }
}
photos.sort((a, b) => a.shows[0].localeCompare(b.shows[0]) || a.title.localeCompare(b.title, undefined, { numeric: true }));

const out = { source: { name: "Wikimedia Commons", url: "https://commons.wikimedia.org/wiki/Category:Phish", fetched: new Date().toISOString().slice(0, 10) }, photos };
writeFileSync(new URL("../data/photos.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${photos.length} photos of ${new Set(photos.flatMap((p) => p.shows)).size} shows`);
