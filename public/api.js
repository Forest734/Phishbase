// Asks the Express API. The GitHub Pages build, which has no server, swaps
// this file for static/api.js (see scripts/build-pages.js).
export async function api(path) {
  const res = await fetch(`api/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
