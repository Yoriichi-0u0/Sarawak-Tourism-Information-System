import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const base = process.env.STIS_QA_BASE ?? "http://127.0.0.1:4173";
const axe = readFileSync(new URL("./node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const browser = await chromium.launch({ executablePath: process.env.STIS_QA_BROWSER });
const summary = new Map();
async function scan(page, label) {
  await page.waitForLoadState("networkidle"); await page.waitForTimeout(300);
  await page.addScriptTag({ content: axe });
  const result = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } }))
    .violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target.join(" "), help: v.help })));
  for (const v of result) { const key = `${v.id} (${v.impact})`; const entry = summary.get(key) ?? { help: v.help, where: [] }; entry.where.push(`${label}[${v.nodes}] ${v.sample}`); summary.set(key, entry); }
  console.log(label, result.length ? result.map((v) => `${v.id}:${v.nodes}`).join(" ") : "clean");
}
for (const scheme of ["light", "dark"]) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: scheme });
  const page = await context.newPage();
  if (process.env.STIS_QA_SHARE) await page.goto(process.env.STIS_QA_SHARE, { waitUntil: "load" });
  for (const route of ["/", "/destinations", "/destinations/bako", "/stay", "/transport?from=Kuching&to=Bako", "/food/demo-laksa-breakfast", "/events", "/visitor-info", "/trips", "/account/sign-in", "/account/register", "/credits", "/nope"]) {
    await page.goto(base + route); await scan(page, `${scheme} ${route}`);
  }
  const created = await page.evaluate(async () => {
    const post = (url, body, headers = {}) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }).then((r) => r.json());
    const { plan, guest } = await post("/api/v1/itineraries", { title: "Axe trip", date: "2026-12-18", endDate: "2026-12-19", provisional: true });
    const auth = { authorization: `Guest ${guest}` };
    const put = (revision, change) => fetch(`/api/v1/itineraries/${plan.id}`, { method: "PUT", headers: { "content-type": "application/json", ...auth }, body: JSON.stringify({ revision, change }) }).then((r) => r.json());
    let p = await put(1, { action: "add", recordId: "demo-cultural-evening", day: "2026-12-19", start: "19:30", end: "21:30" });
    p = await put(p.revision, { action: "add", recordId: "bako", day: "2026-12-19", start: "20:00", end: "22:00" });
    const { token } = await post(`/api/v1/itineraries/${plan.id}/share`, {}, auth);
    return { id: plan.id, guest, token };
  });
  await page.goto(`${base}/trips/guest#${created.id}/${created.guest}`); await page.getByRole("heading", { level: 1 }).waitFor(); await scan(page, `${scheme} trip(conflict)`);
  await page.goto(`${base}/trips/shared#${created.token}`); await page.getByRole("heading", { level: 1 }).waitFor(); await scan(page, `${scheme} shared`);
  await page.goto(`${base}/account/sign-in`);
  await page.getByLabel("Email").fill(process.env.QA_ADMIN_EMAIL); await page.getByLabel("Password").fill(process.env.QA_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL(/\/staff$/);
  await page.locator(".record-list button").first().click(); await scan(page, `${scheme} staff-editor`);
  await page.getByRole("button", { name: "Staff accounts" }).click(); await scan(page, `${scheme} staff-accounts`);
  await page.goto(`${base}/account`); await scan(page, `${scheme} profile`);
  await context.close();
}
console.log("\n=== violations by rule ===");
for (const [rule, { help, where }] of summary) console.log(`${rule}: ${help}\n   ${where.slice(0, 6).join("\n   ")}${where.length > 6 ? `\n   …${where.length - 6} more` : ""}`);
await browser.close();
