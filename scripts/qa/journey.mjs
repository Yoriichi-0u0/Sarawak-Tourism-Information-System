import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const out = process.argv[2];
const width = Number(process.argv[3] ?? 1366);
const tag = width < 600 ? "m" : "d";
const base = process.env.STIS_QA_BASE ?? "http://127.0.0.1:4173";
const adminPassword = process.env.QA_ADMIN_PASSWORD, adminEmail = process.env.QA_ADMIN_EMAIL;
const browser = await chromium.launch(process.env.STIS_QA_BROWSER ? { executablePath: process.env.STIS_QA_BROWSER } : {});
const results = []; let step = 0;
const errors = [];
const browserJson = (page, path) => page.evaluate(async (url) => { const reply = await fetch(url); return { ok: reply.ok, status: reply.status, body: reply.ok ? await reply.json() : null }; }, `/api/v1/${path}`);
const newPage = async (scheme = "light") => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, acceptDownloads: true });
  const page = await ctx.newPage();
  if (process.env.STIS_QA_SHARE) await page.goto(process.env.STIS_QA_SHARE, { waitUntil: "load" });
  page.on("pageerror", (e) => errors.push(`pageerror ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/409|422|401|403|404|400/.test(m.text())) errors.push(`console ${m.text()}`); });
  return page;
};
async function check(page, name, fn) {
  step++;
  try { const detail = await fn(); results.push(`PASS ${step}. ${name}${detail ? ` — ${detail}` : ""}`); }
  catch (e) { results.push(`FAIL ${step}. ${name} — ${e.message.split("\n")[0]}`); await page.screenshot({ path: `${out}/${tag}-fail-${step}.png`, fullPage: true }); throw e; }
}
const overflow = [];
const shot = async (page, name) => {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth
    ? [...document.querySelectorAll("main *, header *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest(".sr-only") && !el.parentElement?.closest(".table-scroll"))
      .slice(0, 4).map((el) => `${el.tagName}.${typeof el.className === "string" ? el.className : ""}`) : []);
  if (wide.length) overflow.push(`${name}: ${wide.join(", ")}`);
  await page.screenshot({ path: `${out}/${tag}-${name}.png`, fullPage: true });
};
const go = async (page, path) => { await page.goto(base + path, { waitUntil: "networkidle" }); };
const nav = async (page, label) => {
  if (width < 1080) { await page.getByRole("button", { name: "Open menu" }).click(); await page.locator("#mobile-nav").getByRole("link", { name: label, exact: true }).click(); }
  else await page.getByRole("navigation", { name: "Explore" }).getByRole("link", { name: label, exact: true }).click();
  await page.waitForTimeout(150);
  await page.waitForLoadState("networkidle");
};
const email = `qa-${tag}-${Date.now()}@example.test`;
const tourist = await newPage();
try {
  await check(tourist, "Home lists all six categories", async () => {
    await go(tourist, "/");
    const tiles = await tourist.locator(".tile").count();
    if (tiles !== 6) throw new Error(`tiles=${tiles}`);
  });
  await check(tourist, "Home search lands on filtered destinations", async () => {
    await tourist.getByRole("searchbox").first().fill("Mulu");
    await tourist.getByRole("button", { name: "Search" }).first().click();
    await tourist.waitForURL(/\/destinations/);
    await tourist.locator(".card h3", { hasText: "Mulu" }).first().waitFor();
    await tourist.waitForLoadState("networkidle");
    const titles = await tourist.locator(".card h3").allTextContents();
    if (!titles.length || !titles.every((t) => /Mulu/i.test(t))) throw new Error(titles.join("|"));
    return titles.join(", ");
  });
  await check(tourist, "T5 events show status in text (cancelled, postponed)", async () => {
    await nav(tourist, "Events");
    await tourist.locator(".card", { hasText: "Cave photography morning" }).waitFor();
    const body = await tourist.locator("main").innerText();
    if (!/Cancelled/.test(body) || !/Postponed/.test(body)) throw new Error("status badges missing");
    await shot(tourist, "events");
  });
  await check(tourist, "T6 guest creates a 3-day trip from an event", async () => {
    const card = tourist.locator(".card", { hasText: "Evening of traditional music" });
    await card.getByRole("button", { name: /Add to trip/ }).click();
    const dialog = tourist.getByRole("dialog");
    await dialog.getByLabel("Trip name").fill("QA December trip");
    await dialog.getByLabel("First day").fill("2026-12-18");
    await dialog.getByLabel(/Last day/).fill("2026-12-20");
    if (await dialog.locator("select[name=day]").inputValue() !== "2026-12-19") throw new Error("event day not preselected");
    if (await dialog.locator("input[name=start]").inputValue() !== "19:30") throw new Error("event time not prefilled");
    await dialog.locator("input[name=end]").fill("21:30");
    await dialog.getByRole("button", { name: "Add to trip" }).click();
    await dialog.getByText("is in “QA December trip”").waitFor();
    await dialog.getByRole("link", { name: "Open trip" }).click();
    await tourist.waitForURL(/\/trips\/guest#/);
    await tourist.getByRole("heading", { level: 1, name: "QA December trip" }).waitFor();
    const days = await tourist.locator(".day-head h2").count();
    if (days !== 3) throw new Error(`days=${days}`);
    return tourist.url().replace(/[\w-]{43}$/, "<token>");
  });
  await check(tourist, "T1 detail page adds an overlapping destination stop", async () => {
    await nav(tourist, "Destinations");
    await tourist.locator(".card", { hasText: "Bako National Park" }).waitFor();
    await tourist.locator(".card", { hasText: "Bako National Park" }).getByRole("link", { name: "Bako National Park" }).click();
    await tourist.getByRole("heading", { level: 1, name: "Bako National Park" }).waitFor();
    await tourist.getByRole("button", { name: /Add to trip/ }).first().click();
    const dialog = tourist.getByRole("dialog");
    await dialog.locator("select").first().selectOption({ label: /QA December trip/ }).catch(async () => {
      const opts = await dialog.locator("select").first().locator("option").allTextContents(); const pick = opts.find((o) => o.includes("QA December trip"));
      await dialog.locator("select").first().selectOption({ label: pick });
    });
    await dialog.locator("select[name=day]").selectOption("2026-12-19");
    await dialog.locator("input[name=start]").fill("20:00");
    await dialog.locator("input[name=end]").fill("22:00");
    await dialog.getByRole("button", { name: "Add to trip" }).click();
    await dialog.getByText(/1 time conflict/).waitFor();
    await dialog.getByRole("link", { name: "Open trip" }).click();
    await tourist.getByRole("heading", { level: 1, name: "QA December trip" }).waitFor();
  });
  await check(tourist, "Conflict names both stops with intervals, highlighted without colour alone", async () => {
    const notice = tourist.getByRole("alert").filter({ hasText: "time conflict" });
    const text = await notice.innerText();
    if (!/Evening of traditional music/.test(text) || !/Bako National Park/.test(text) || !/19:30/.test(text)) throw new Error(text);
    const flagged = await tourist.locator('.stop[data-conflict="true"]').count();
    const badges = await tourist.locator(".stop .badge.danger", { hasText: "Overlaps" }).count();
    if (flagged !== 2 || badges !== 2) throw new Error(`flagged=${flagged} badges=${badges}`);
    await shot(tourist, "trip-conflict");
  });
  await check(tourist, "Edit a stop resolves the conflict", async () => {
    await tourist.getByRole("button", { name: "Edit Bako National Park" }).click();
    const form = tourist.getByRole("form", { name: "Edit Bako National Park" });
    await form.locator("input[name=start]").fill("09:00"); await form.locator("input[name=end]").fill("12:00");
    await form.locator("input[name=note]").fill("Boat from Kampung Bako");
    await form.getByRole("button", { name: "Save stop" }).click();
    await tourist.waitForFunction(() => !document.querySelector('.stop[data-conflict="true"]'));
    await tourist.getByText("Note: Boat from Kampung Bako").waitFor();
  });
  await check(tourist, "Reorder stops within a day", async () => {
    const before = await tourist.locator(".stop h3").allTextContents();
    await tourist.getByRole("button", { name: `Move ${before[1]} earlier` }).click();
    await tourist.waitForFunction((first) => document.querySelector(".stop h3")?.textContent !== first, before[0]);
    const after = await tourist.locator(".stop h3").allTextContents();
    return `${before.join(" > ")}  ⇒  ${after.join(" > ")}`;
  });
  await check(tourist, "Calendar export downloads a valid ICS", async () => {
    const [download] = await Promise.all([tourist.waitForEvent("download"), tourist.getByRole("button", { name: /Calendar/ }).click()]);
    const path = `${out}/${tag}-trip.ics`; await download.saveAs(path);
    const ics = readFileSync(path, "utf8");
    if (!/BEGIN:VCALENDAR/.test(ics) || (ics.match(/BEGIN:VEVENT/g) ?? []).length !== 2) throw new Error(ics.slice(0, 200));
    return download.suggestedFilename();
  });
  await check(tourist, "Guest trip survives a reload from its link", async () => {
    await tourist.reload({ waitUntil: "networkidle" });
    await tourist.getByRole("heading", { level: 1, name: "QA December trip" }).waitFor();
    if (await tourist.locator(".stop").count() !== 2) throw new Error("stops lost");
  });
  await check(tourist, "Register shows ten one-time recovery codes", async () => {
    await tourist.getByRole("link", { name: "Sign in" }).first().click();
    await tourist.getByRole("link", { name: /Create an account|Create one|Register/ }).first().click();
    await tourist.getByLabel("Display name").fill("QA Tourist");
    await tourist.getByLabel("Email").fill(email);
    await tourist.getByLabel(/^Password/).fill("correct horse battery");
    await tourist.getByLabel("Confirm password").fill("correct horse battery");
    await tourist.getByRole("button", { name: "Create account" }).click();
    await tourist.getByRole("heading", { name: "Save your recovery codes" }).waitFor();
    const codes = await tourist.locator(".codes span").count();
    if (codes !== 10) throw new Error(`codes=${codes}`);
    await shot(tourist, "recovery-codes");
    await tourist.getByLabel("I have saved these codes somewhere safe").check();
    await tourist.getByRole("button", { name: "Continue" }).click();
    await tourist.waitForURL(/\/trips$/);
  });
  await check(tourist, "Claim the guest trip into the account", async () => {
    await tourist.getByRole("link", { name: "Open guest trip" }).click();
    await tourist.getByRole("button", { name: "Save to my account" }).click();
    await tourist.getByText("Saved to your account").first().waitFor();
    if (/#/.test(tourist.url())) await tourist.waitForURL(/\/trips\/[\w-]+$/);
  });
  await check(tourist, "Sign out, sign in, reopen and modify the saved trip", async () => {
    await go(tourist, "/account");
    await tourist.getByRole("button", { name: "Sign out" }).click();
    await tourist.waitForURL(base + "/");
    await tourist.getByRole("link", { name: "Sign in" }).first().click();
    await tourist.getByLabel("Email").fill(email);
    await tourist.getByLabel("Password").fill("correct horse battery");
    await tourist.getByRole("button", { name: "Sign in" }).click();
    await tourist.waitForURL(/\/trips$/);
    await tourist.getByRole("link", { name: /QA December trip/ }).first().click();
    await tourist.getByRole("heading", { level: 1, name: "QA December trip" }).waitFor();
    if (await tourist.locator(".stop").count() !== 2) throw new Error("stops missing after reopen");
    await tourist.getByLabel("Trip name").fill("QA Sarawak December");
    await tourist.getByRole("button", { name: "Rename" }).click();
    await tourist.getByRole("heading", { level: 1, name: "QA Sarawak December" }).waitFor();
    await shot(tourist, "trip-saved");
  });
  await check(tourist, "Share a view-only link; the viewer cannot edit; stopping sharing revokes it", async () => {
    await tourist.getByRole("button", { name: "Create view-only link" }).click();
    const link = await tourist.getByRole("textbox", { name: "View-only link" }).inputValue();
    if (!/\/trips\/shared#[\w-]{43}$/.test(link)) throw new Error(`unexpected link ${link.replace(/[\w-]{43}$/, "<token>")}`);
    const viewer = await newPage("dark");
    await viewer.goto(link, { waitUntil: "networkidle" });
    await viewer.getByRole("heading", { level: 1, name: "QA Sarawak December" }).waitFor();
    const controls = await viewer.locator("main button", { hasText: /^(Edit|Remove|Rename|Update dates|Delete this trip)/ }).count();
    if (controls) throw new Error(`viewer sees ${controls} edit controls`);
    if (await viewer.locator(".stop").count() !== 2) throw new Error("viewer does not see the stops");
    await shot(viewer, "trip-shared-view");
    await tourist.getByRole("button", { name: "Stop sharing" }).click();
    await tourist.getByText("Sharing stopped.").waitFor();
    await viewer.reload({ waitUntil: "networkidle" });
    await viewer.getByRole("heading", { level: 1, name: /no longer available/ }).waitFor();
    await viewer.context().close();
  });
  await check(tourist, "Compare two places to stay", async () => {
    await nav(tourist, "Stay");
    await tourist.locator(".card", { hasText: "Mulu park headquarters accommodation" }).waitFor();
    for (const name of ["Bako National Park lodging", "Mulu park headquarters accommodation"])
      await tourist.locator(".card", { hasText: name }).getByRole("button", { name: /Compare/ }).click();
    await tourist.getByRole("region", { name: "Comparison" }).getByRole("link", { name: "Compare" }).click();
    await tourist.getByRole("table").waitFor();
    const cols = await tourist.locator("table thead th").count();
    if (cols !== 2) throw new Error(`cols=${cols}`);
    await shot(tourist, "compare");
  });
  await check(tourist, "T3 journey planner returns options Kuching → Bako", async () => {
    await nav(tourist, "Getting around");
    await tourist.locator("input[name=from]").fill("Kuching");
    await tourist.locator("input[name=to]").fill("Bako");
    await tourist.getByRole("button", { name: "Find options" }).click();
    await tourist.waitForLoadState("networkidle");
    const text = await tourist.locator("main").innerText();
    if (/No (direct|route|options)/i.test(text) && !/Option/i.test(text)) throw new Error(text.slice(0, 300));
    await shot(tourist, "transport");
  });
  await check(tourist, "T8 visitor information shows emergency guidance", async () => {
    await nav(tourist, "Visitor info");
    await tourist.locator("main").getByText(/999/).first().waitFor();
    const text = await tourist.locator("main").innerText();
    if (!/999/.test(text)) throw new Error("no emergency number");
  });

  const staff = await newPage("dark");
  await check(staff, "Admin signs in and reaches the staff console", async () => {
    await go(staff, "/account/sign-in");
    await staff.getByLabel("Email").fill(adminEmail);
    await staff.getByLabel("Password").fill(adminPassword);
    await staff.getByRole("button", { name: "Sign in" }).click();
    await staff.waitForURL(/\/staff$/);
    await staff.getByRole("heading", { name: "Maintain tourism information" }).waitFor();
  });
  await check(staff, "Incomplete drafts save, but publication is blocked with field errors", async () => {
    await staff.getByRole("button", { name: /Evening of traditional music/ }).click();
    await staff.locator("#field-title").fill("");
    await staff.getByRole("button", { name: "Save draft" }).click();
    await staff.getByText(/Draft v\d+ saved/).waitFor();
    const focused = await staff.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`);
    await staff.getByRole("button", { name: "Publish", exact: true }).click();
    await staff.getByRole("alert").filter({ hasText: /title/i }).first().waitFor();
    if (await staff.locator("#field-title").getAttribute("aria-invalid") !== "true") throw new Error("title not marked invalid");
    const pub = (await browserJson(staff, "catalog/event/demo-cultural-evening")).body;
    if (pub.fields.title !== "Evening of traditional music") throw new Error("blank title published");
    await staff.locator("#field-title").click();
    await staff.keyboard.type("Evening of traditional music", { delay: 15 });
    const kept = await staff.evaluate(() => document.activeElement?.id);
    if (kept !== "field-title") throw new Error(`typing lost focus to ${kept}`);
    if (await staff.locator("#field-title").inputValue() !== "Evening of traditional music") throw new Error("typed text lost");
    await staff.getByRole("button", { name: "Save draft" }).click();
    await staff.getByText(/Draft v\d+ saved/).waitFor();
    return `focus after save: ${focused}; typing keeps focus in the field`;
  });
  await check(staff, "Staff cancels an event: draft is isolated until published", async () => {
    await staff.locator("#field-status").selectOption("cancelled");
    await staff.getByRole("button", { name: "Save draft" }).click();
    await staff.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent === "Publish" && !b.disabled));
    const before = (await browserJson(staff, "catalog/event/demo-cultural-evening")).body;
    if (before.fields.status !== "scheduled") throw new Error("draft leaked to public");
    await staff.getByRole("button", { name: "Publish", exact: true }).click();
    await staff.waitForFunction(async () => (await (await fetch("/api/v1/catalog/event/demo-cultural-evening")).json()).fields.status === "cancelled");
    await staff.getByText(/Published v/).first().waitFor();
    await shot(staff, "staff-published");
  });
  await check(tourist, "Tourist trip shows the published cancellation", async () => {
    await go(tourist, "/trips");
    await tourist.getByRole("link", { name: /QA Sarawak December/ }).first().click();
    await tourist.getByText("Event cancelled").waitFor();
  });
  await check(staff, "Withdrawing a referenced destination is refused and names the dependants", async () => {
    await staff.locator(".record-list button", { has: staff.locator("strong", { hasText: /^Bako National Park$/ }) }).click();
    await staff.getByRole("button", { name: /Withdraw/ }).click();
    await staff.getByRole("button", { name: "Confirm withdrawal" }).click();
    const text = await staff.getByRole("alert").filter({ hasText: "refer to this destination" }).innerText();
    if (!/Bako National Park lodging/.test(text)) throw new Error(text);
    if (!(await browserJson(staff, "catalog/destination/bako")).ok) throw new Error("destination withdrawn anyway");
    return text.trim();
  });
  await check(staff, "Withdrawal keeps the itinerary entry but marks it unavailable", async () => {
    await staff.locator(".record-list button", { has: staff.locator("strong", { hasText: /^Evening of traditional music$/ }) }).click();
    await staff.getByRole("button", { name: /Withdraw/ }).click();
    await staff.getByRole("button", { name: "Confirm withdrawal" }).click();
    await staff.getByText(/^Withdrawn\./).waitFor();
    await staff.waitForFunction(async () => (await fetch("/api/v1/catalog/event/demo-cultural-evening")).status === 404);
    await tourist.reload({ waitUntil: "networkidle" });
    await tourist.getByText("Current information unavailable").waitFor();
    if (await tourist.locator(".stop").count() !== 2) throw new Error("entry removed");
    await shot(tourist, "trip-withdrawn");
    await staff.getByRole("button", { name: "Publish", exact: true }).click();
    await staff.waitForFunction(async () => (await fetch("/api/v1/catalog/event/demo-cultural-evening")).ok);
  });
  await check(staff, "Record history lists save, publish and withdrawal", async () => {
    const text = await staff.locator(".panel", { hasText: "History" }).innerText();
    if (!/Withdrew/.test(text) || !/Published/.test(text)) throw new Error(text);
  });
  await check(staff, "Admin creates a staff account", async () => {
    await staff.getByRole("button", { name: "Staff accounts" }).click();
    await staff.locator("input[name=displayName]").fill("QA Staff");
    await staff.locator("input[name=email]").fill(`staff-${email}`);
    await staff.locator("input[name=password]").fill("temporary staff pass");
    await staff.getByRole("button", { name: "Create account" }).click();
    await staff.getByText(`staff-${email}`).waitFor();
    const probe = await staff.evaluate(() => ({ active: `${document.activeElement?.tagName}.${document.activeElement?.className}`, skip: Math.round(document.querySelector(".skip-link").getBoundingClientRect().top) }));
    if (probe.skip >= 0) throw new Error(`skip link visible: ${JSON.stringify(probe)}`);
    await shot(staff, "staff-accounts");
  });
  await check(tourist, "Tourists cannot open the staff console or API", async () => {
    await go(tourist, "/staff");
    const text = await tourist.locator("main").innerText();
    const api = await tourist.evaluate(async () => (await fetch("/api/v1/staff/records")).status);
    if (/Maintain tourism information/.test(text) || api !== 403) throw new Error(`api=${api}`);
    return `API ${api}`;
  });
  await check(tourist, "Unknown route shows a 404 page with an h1", async () => {
    await go(tourist, "/definitely/not/here");
    await tourist.getByRole("heading", { level: 1, name: /couldn't find/ }).waitFor();
  });
} catch {}
console.log(results.join("\n"));
console.log("errors:", errors.length ? errors.join("\n") : "none");
console.log("overflow:", overflow.length ? overflow.join("\n") : "none");
await browser.close();
