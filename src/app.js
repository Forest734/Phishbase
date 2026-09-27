import express from "express";
import { handle } from "./api.js";

const app = express();
app.disable("x-powered-by");
app.use(express.static(new URL("../public", import.meta.url).pathname));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Every /api route is in src/api.js, which the GitHub Pages build shares.
app.get("/api{/*path}", async (req, res) => {
  const { status, body } = await handle(req.path.replace(/^\/api\/?/, ""), req.query);
  res.status(status).json(body);
});

export { app };
