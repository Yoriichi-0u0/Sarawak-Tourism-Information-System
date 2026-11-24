import { chromium } from "playwright-core";
const base = process.env.STIS_QA_BASE ?? "http://127.0.0.1:4173";
const browser = await chromium.launch({ executablePath: process.env.STIS_QA_BROWSER });
const lcpScript = () => new Promise((resolve) => { let last = 0; new PerformanceObserver((list) => { for (const e of list.getEntries()) last = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true }); setTimeout(() => resolve(last), 2500); });
async function run(label, viewport, throttle) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  if (process.env.STIS_QA_SHARE) await page.goto(process.env.STIS_QA_SHARE, { waitUntil: "load" });
  if (throttle) { const cdp = await context.newCDPSession(page); await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 9_000_000 / 8, uploadThroughput: 1_500_000 / 8 }); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
  const rows = [];
  for (const route of ["/", "/destinations", "/destinations/mulu", "/stay?accessibility=step-free-entrance", "/transport?from=Kuching&to=Bako", "/events", "/credits"]) {
    const started = Date.now();
    await page.goto(base + route, { waitUntil: "load" });
    const lcp = await page.evaluate(lcpScript);
    await page.waitForLoadState("networkidle");
    const nav = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; const bytes = performance.getEntriesByType("resource").reduce((sum, r) => sum + (r.transferSize || 0), 0) + (n.transferSize || 0); return { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), bytes }; });
    rows.push(`${label.padEnd(8)} ${route.padEnd(40)} TTFB ${String(nav.ttfb).padStart(4)}ms  LCP ${String(Math.round(lcp)).padStart(5)}ms  ready ${String(Date.now() - started).padStart(5)}ms  ${(nav.bytes / 1024).toFixed(0)} KB`);
  }
  const api = await page.evaluate(async () => {
    const time = async (fn) => { const t = performance.now(); await fn(); return Math.round(performance.now() - t); };
    const out = {};
    out["GET catalog/destination?query=bako"] = await time(() => fetch("/api/v1/catalog/destination?query=bako").then((r) => r.json()));
    out["GET journeys Kuching→Mulu"] = await time(() => fetch("/api/v1/journeys?from=Kuching&to=Mulu").then((r) => r.json()));
    const created = await fetch("/api/v1/itineraries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "QA perf trip", date: "2026-12-18", provisional: true }) }).then((r) => r.json());
    out["PUT itinerary add stop"] = await time(() => fetch(`/api/v1/itineraries/${created.plan.id}`, { method: "PUT", headers: { "content-type": "application/json", authorization: `Guest ${created.guest}` }, body: JSON.stringify({ revision: 1, change: { action: "add", recordId: "bako", start: "09:00", end: "10:00" } }) }).then((r) => r.json()));
    await fetch(`/api/v1/itineraries/${created.plan.id}`, { method: "DELETE", headers: { authorization: `Guest ${created.guest}` } });
    return out;
  });
  rows.push(`${label} API: ${Object.entries(api).map(([k, v]) => `${k} ${v}ms`).join(" · ")}`);
  console.log(rows.join("\n"));
  await context.close();
}
await run("desktop", { width: 1366, height: 900 }, false);
await run("mobile*", { width: 390, height: 844 }, true);
await browser.close();
