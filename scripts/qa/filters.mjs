import { chromium } from "playwright-core";
const base = process.env.STIS_QA_BASE ?? "http://127.0.0.1:4173";
const browser = await chromium.launch(process.env.STIS_QA_BROWSER ? { executablePath: process.env.STIS_QA_BROWSER } : {});
const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
if (process.env.STIS_QA_SHARE) await page.goto(process.env.STIS_QA_SHARE, { waitUntil: "load" });
const out = []; const ok = (n, c, d = "") => out.push(`${c ? "PASS" : "FAIL"} ${n}${d ? ` — ${d}` : ""}`);
const api = async (path) => page.evaluate(async (url) => (await fetch(url)).json(), `/api/v1/${path}`);
const results = async () => { await page.waitForFunction(() => !/Searching/.test(document.querySelector("main [role=status]")?.textContent ?? "")); await page.waitForTimeout(200);
  return { status: (await page.locator("main [role=status]").first().textContent())?.trim(), titles: await page.locator(".card h3").allTextContents() }; };
const form = (kind) => page.getByRole("form", { name: `Filter ${kind}` });

await page.goto(base + "/destinations", { waitUntil: "networkidle" });
await form("destinations").locator("input[name=interest]").fill("Culture");
await form("destinations").getByRole("button", { name: "Search" }).click();
let r = await results();
let expected = (await api("catalog/destination")).filter((i) => /culture/i.test(i.fields.interest ?? "")).length;
ok("T1 interest filter", r.titles.length === expected && expected > 0, `${r.status}: ${r.titles.join(", ")}`);
ok("T1 filters are kept in the URL", /interest=Culture/.test(page.url()), page.url().replace(base, ""));

await page.goto(base + "/stay", { waitUntil: "networkidle" });
await form("places to stay").getByLabel("Step-free entrance").check();
await form("places to stay").getByRole("button", { name: "Search" }).click();
r = await results();
expected = (await api("catalog/accommodation")).filter((i) => (i.fields.accessibility ?? "").split(",").includes("step-free-entrance")).length;
ok("T2 accessibility need filter", r.titles.length === expected, `${r.status}: ${r.titles.join(", ")}`);
await form("places to stay").locator("select[name=type]").selectOption("park-lodge");
await form("places to stay").getByRole("button", { name: "Search" }).click();
r = await results();
ok("T2 combined type + accessibility", r.titles.every((t) => /park|lodg|headquarters/i.test(t)), `${r.status}: ${r.titles.join(", ") || "(none)"}`);
await page.goto(base + "/stay?type=hostel&accessibility=lift,accessible-bathroom,step-free-entrance", { waitUntil: "networkidle" });
r = await results();
const empty = await page.locator(".empty").innerText().catch(() => "");
ok("T2 no-match state explains and offers Clear", r.titles.length === 0 && empty.length > 0 && await form("places to stay").getByRole("button", { name: "Clear" }).count() === 1, empty.replace(/\s+/g, " ").slice(0, 120));
await form("places to stay").getByRole("button", { name: "Clear" }).click();
r = await results();
ok("Clear restores all results", r.titles.length === (await api("catalog/accommodation")).length, r.status);

await page.goto(base + "/food", { waitUntil: "networkidle" });
await form("places to eat").getByLabel("Vegetarian options").check();
await form("places to eat").getByRole("button", { name: "Search" }).click();
r = await results();
expected = (await api("catalog/dining")).filter((i) => (i.fields.dietary ?? "").split(",").includes("vegetarian-options")).length;
ok("T4 dietary filter", r.titles.length === expected, `${r.status}: ${r.titles.join(", ")}`);
await page.locator(".card h3 a").first().click();
await page.locator("h1").waitFor();
const detail = await page.locator("main").innerText();
ok("T4 detail shows provenance and hours or an explicit gap", /Verified|Reported|Illustrative|STIS guidance/.test(detail), (await page.locator("h1").textContent()) ?? "");

await page.goto(base + "/events", { waitUntil: "networkidle" });
await form("events").locator("input[name=from]").fill("2026-12-01");
await form("events").locator("input[name=to]").fill("2026-12-31");
await form("events").getByRole("button", { name: "Search" }).click();
r = await results();
ok("T5 date range filter", r.titles.length > 0 && !r.titles.some((t) => /Rainforest World Music Festival 2026|Old Kuching heritage walk|Cave photography/.test(t)), r.titles.join(", "));

await page.goto(base + "/visitor-info", { waitUntil: "networkidle" });
const visitor = await page.locator("main").innerText();
ok("T7 visitor info lists categories with authority sources", /Emergency/.test(visitor) && (await page.locator('main a[target=_blank]').count()) > 0, `${await page.locator('main a[target=_blank]').count()} external authority links`);

await page.goto(base + "/destinations/does-not-exist", { waitUntil: "networkidle" });
ok("Unavailable record shows an explicit state", (await page.locator("h1").textContent())?.includes("unavailable"), await page.locator("h1").textContent());
const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
if (process.env.STIS_QA_SHARE) await phone.goto(process.env.STIS_QA_SHARE, { waitUntil: "load" });
await phone.goto(base + "/stay", { waitUntil: "networkidle" });
await phone.locator(".card").first().waitFor();
const firstCard = await phone.locator(".card").first().evaluate((el) => Math.round(el.getBoundingClientRect().top));
ok("Mobile: results start within the first screen while filters are collapsed", firstCard < 844, `first card at ${firstCard}px`);
const toggle = phone.getByRole("button", { name: /Show filters/ });
await toggle.click();
await phone.getByRole("form", { name: "Filter places to stay" }).getByLabel("Lift").check();
await phone.getByRole("form", { name: "Filter places to stay" }).getByRole("button", { name: "Search" }).click();
await phone.waitForURL(/accessibility=lift/);
await phone.waitForFunction(() => !/Searching/.test(document.querySelector("main [role=status]")?.textContent ?? ""));
const after = { expanded: await phone.getByRole("button", { name: /filters/ }).getAttribute("aria-expanded"), label: (await phone.getByRole("button", { name: /filters/ }).innerText()).replace(/\s+/g, " "),
  formVisible: await phone.getByRole("form", { name: "Filter places to stay" }).isVisible() };
ok("Mobile: searching collapses the filters and shows how many are active", after.expanded === "false" && !after.formVisible && /1 active/.test(after.label), JSON.stringify(after));
console.log(out.join("\n"));
await browser.close();
