// Renders every page of docs/database/DATABASE_ERD.drawio to SVG and PNG with the official draw.io viewer
// (viewer.diagrams.net) in headless Chromium, so the exports are draw.io's own rendering of the editable source.
// Needs playwright-core and a Chromium executable outside the repository (as for scripts/qa):
//   STIS_QA_BROWSER=<chromium> node scripts/database/render-erd.mjs   (run from a folder where playwright-core is installed,
//   passing the repository path as the first argument)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const repo = process.argv[2] ?? process.cwd();
const docs = join(repo, "docs", "database");
const xml = readFileSync(join(docs, "DATABASE_ERD.drawio"), "utf8");
const names = [...xml.matchAll(/<diagram id="[^"]+" name="([^"]+)"/g)].map((m) => m[1]);
const files = ["DATABASE_ERD-1-conceptual", "DATABASE_ERD-2-physical-accounts-itineraries", "DATABASE_ERD-3-physical-tourism-publication", "DATABASE_ERD-4-access-security"];
if (names.length !== files.length) throw new Error(`expected ${files.length} pages, found ${names.length}`);

const browser = await chromium.launch(process.env.STIS_QA_BROWSER ? { executablePath: process.env.STIS_QA_BROWSER } : {});
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 1000 } });
for (const [index, file] of files.entries()) {
  const config = { highlight: "none", nav: false, resize: false, toolbar: null, edit: null, lightbox: false, page: index, zoom: 1, xml };
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff}</style></head><body>
    <div id="d" class="mxgraph" data-mxgraph='${JSON.stringify(config).replace(/&/g, "&amp;").replace(/'/g, "&#39;")}'></div>
    <script src="https://viewer.diagrams.net/js/viewer-static.min.js"></script></body></html>`, { waitUntil: "networkidle" });
  await page.waitForSelector("#d svg", { timeout: 60000 });
  await page.waitForTimeout(500);
  const svg = await page.evaluate(() => {
    const node = document.querySelector("#d svg");
    const box = node.getBBox();
    const pad = 16;
    const clone = node.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("viewBox", `${box.x - pad} ${box.y - pad} ${box.width + 2 * pad} ${box.height + 2 * pad}`);
    clone.setAttribute("width", String(Math.ceil(box.width + 2 * pad)));
    clone.setAttribute("height", String(Math.ceil(box.height + 2 * pad)));
    clone.removeAttribute("style");
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    for (const [k, v] of Object.entries({ x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad, fill: "#ffffff" })) bg.setAttribute(k, String(v));
    clone.insertBefore(bg, clone.firstChild);
    return { text: clone.outerHTML, foreign: clone.querySelectorAll("foreignObject").length, width: box.width, height: box.height };
  });
  if (svg.foreign) throw new Error(`${file}: ${svg.foreign} foreignObject elements (labels must be plain SVG text)`);
  writeFileSync(join(docs, `${file}.svg`), `<?xml version="1.0" encoding="UTF-8"?>\n${svg.text}\n`);
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${svg.text}</body></html>`);
  await page.locator("svg").first().screenshot({ path: join(docs, `${file}.png`) });
  console.log(`${names[index]} -> ${file}.svg/.png (${Math.round(svg.width)}×${Math.round(svg.height)} px at 1×; PNG at 2×)`);
}
await browser.close();
