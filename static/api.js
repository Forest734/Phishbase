// Stands in for public/api.js on GitHub Pages, which has no server: the API
// (src/api.js) runs in the browser, over the same data and code as the
// Express app. scripts/build-pages.js puts it in place.
import { handle } from "./src/api.js";

export async function api(path) {
  const [route, query = ""] = path.split("?");
  const { status, body } = await handle(route, Object.fromEntries(new URLSearchParams(query)));
  if (status === 404) return null;
  // A copy, as the server's JSON would be, so a page can't change the data.
  return JSON.parse(JSON.stringify(body));
}
