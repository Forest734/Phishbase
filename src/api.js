// The JSON API as a plain function of a path and a query, so the Express app
// and the GitHub Pages build, which has no server and runs this in the
// browser (static/api.js), answer every request the same way.
import {
  findShows,
  getShow,
  getSong,
  getSongs,
  getSource,
  getStats,
  getTours,
  getYears,
  TAGS,
} from "./data.js";

export const VERSION = "0.1.0";

// The show filters that /api/shows, /api/years and /api/stats all accept.
const filters = ({ year, from, to, song, tag, tour, venue, city, state, country, q }) =>
  ({ year, from, to, song, tag, tour, venue, city, state, country, q });

async function route(name, arg, query) {
  if (arg === undefined) {
    switch (name) {
      case "": return { service: "phishbase", version: VERSION, source: getSource() };
      case "years": return getYears(filters(query));
      case "shows": return findShows(filters(query), { sets: query.sets === "1" });
      case "stats": return getStats(filters(query));
      case "songs": return getSongs();
      case "tours": return getTours();
      case "tags": return Object.entries(TAGS).map(([slug, name]) => ({ slug, name }));
    }
  } else if (name === "shows") {
    return getShow(arg);
  } else if (name === "songs") {
    return getSong(arg);
  }
}

// `path` is what follows "/api/", still URL-encoded, such as
// "shows/1997-11-22"; `query` is the parsed query string. Resolves to
// { status, body }, where body is what the API sends as JSON. It's async
// because a show's notes load on first use.
export async function handle(path, query = {}) {
  let body;
  try {
    const [name, arg, ...extra] = path.replace(/\/$/, "").split("/").map(decodeURIComponent);
    if (!extra.length) body = await route(name, arg, query);
  } catch (err) {
    if (!(err instanceof URIError)) throw err; // a malformed %-escape is just a missing page
  }
  return body === undefined ? { status: 404, body: { error: "not found" } } : { status: 200, body };
}
