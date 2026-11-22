import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { fakeAnnouncementRequests, fakeAnnouncements, resetData, sql } from "./support";

// The project's notices (E18): a page load asks the backend when it's time to,
// and a card over the page shows what applies, one at a time, until it's dismissed. A
// backend that's down or silent changes nothing. Here the fake job sources
// answer for the backend (DOSSIER_API_URL).

type Notice = { id: string; title: string } & Record<string, unknown>;

const notice = (id: string, changes: Record<string, unknown> = {}): Notice => ({
  id,
  severity: "info",
  title: `Notice ${id}`,
  body: `The text of ${id}.`,
  link: null,
  minVersion: null,
  maxVersion: null,
  publishedAt: "2026-11-01T09:00:00Z",
  expiresAt: null,
  ...changes,
});

type Feed = { items: { id: string }[]; etag: string | null; nextCheckAt: string };

async function storedFeed(): Promise<Feed | null> {
  const [row] = await sql<{ value: string }>(`SELECT value FROM "Setting" WHERE key = 'announcementFeed'`);
  return row ? (JSON.parse(row.value) as Feed) : null;
}

/** Loads a page, which asks the backend, and waits until its answer is kept. */
async function publish(page: Page, ...notices: Notice[]) {
  await fakeAnnouncements(notices);
  await page.goto("/");
  await expect.poll(async () => (await storedFeed())?.items.map(({ id }) => id) ?? null).toEqual(notices.map(({ id }) => id));
}

/** Makes the next page load ask again, keeping what's stored. */
const makeDue = () => sql(`UPDATE "Setting" SET value = jsonb_set(value::jsonb, '{nextCheckAt}', '"2020-01-01T00:00:00.000Z"')::text WHERE key = 'announcementFeed'`);

/** Loads a page while it's due and waits until the backend was asked. */
async function askAgain(page: Page) {
  await makeDue();
  const before = (await fakeAnnouncementRequests()).length;
  await page.goto("/");
  await expect.poll(async () => (await fakeAnnouncementRequests()).length).toBeGreaterThan(before);
}

const region = (page: Page, { title }: Notice) => page.getByRole("region", { name: title });

const expectAccessibleNotice = async (page: Page) => {
  // The card fades in, and halfway through, its dimmest text is below the contrast
  // it has once it's there. Check what stays on screen, not a frame of the fade.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => !(animation instanceof CSSAnimation) || animation.animationName !== "notice-in" || animation.playState === "finished"),
  );
  const { violations } = await new AxeBuilder({ page }).include("[role=alert], [role=status]").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id)).toEqual([]);
};

test.beforeAll(resetData);
test.beforeEach(() => sql(`DELETE FROM "Setting" WHERE key IN ('announcementFeed', 'announcementsDismissed', 'latestVersion', 'latestVersionUrl')`));
// Other specs see no notice.
test.afterAll(async () => {
  await fakeAnnouncements([]);
  await sql(`DELETE FROM "Setting" WHERE key IN ('announcementFeed', 'announcementsDismissed', 'latestVersion', 'latestVersionUrl')`);
});

test("shows the most severe first, and each next one after a dismiss, for good", async ({ page }) => {
  const link = { label: "What's new", url: "https://github.com/AienTech/dossier/releases/tag/v99.0.0" };
  const security = notice("security", { severity: "security", link, body: "First line.\nSecond line." });
  const important = notice("important", { severity: "important" });
  const info = notice("info");
  await publish(page, info, security, important);
  await page.goto("/applications");

  const shown = region(page, security);
  await expect(shown).toBeVisible();
  await expect(shown).toContainText("Security");
  await expect(shown).toContainText("First line.");
  await expect(shown.getByRole("link", { name: "What's new (opens in a new tab)" })).toHaveAttribute("href", link.url);
  await expect(page.getByRole("region", { name: /^Notice / })).toHaveCount(1);
  await expectAccessibleNotice(page);

  await shown.getByRole("button", { name: "Dismiss" }).click();
  await expect(shown).toBeHidden();
  await expect(region(page, important)).toBeVisible();
  await expect(region(page, important)).toContainText("Important");
  await expectAccessibleNotice(page);

  await region(page, important).getByRole("button", { name: "Dismiss" }).click();
  await expect(region(page, info)).toBeVisible();
  await expectAccessibleNotice(page);

  // Dismiss hides at once and saves after (#381): reload only once both are saved.
  await expect.poll(async () => (await sql<{ value: string }>(`SELECT value FROM "Setting" WHERE key = 'announcementsDismissed'`))[0]?.value ?? "").toContain(important.id);
  await page.reload();
  await expect(region(page, security)).toBeHidden();
  await expect(region(page, important)).toBeHidden();
  await expect(region(page, info)).toBeVisible();

  await region(page, info).getByRole("button", { name: "Dismiss" }).click();
  await expect(region(page, info)).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: /^Notice / })).toHaveCount(0);
});

test("asks with nothing about the install, and is told when nothing changed", async ({ page }) => {
  const before = (await fakeAnnouncementRequests()).length;
  await publish(page, notice("a"));
  const [first, ...rest] = (await fakeAnnouncementRequests()).slice(before);
  expect(rest).toEqual([]);
  expect(first.url).toBe("/v1/announcements");
  expect(first.headers["user-agent"]).toBe("Dossier");
  // Only what any HTTP client sends (the last two come with cache: "no-store"): no cookie, ID, key or version.
  const fromFetch = ["accept", "accept-encoding", "accept-language", "connection", "host", "sec-fetch-mode", "user-agent", "cache-control", "pragma"];
  expect(Object.keys(first.headers).filter((header) => !fromFetch.includes(header))).toEqual([]);

  // Past the first page load, it doesn't ask until it's time.
  await page.goto("/applications");
  await page.goto("/");
  expect((await fakeAnnouncementRequests()).length).toBe(before + 1);

  const { etag } = (await storedFeed())!;
  await askAgain(page);
  expect((await fakeAnnouncementRequests()).at(-1)!.headers["if-none-match"]).toBe(etag);
  await expect.poll(async () => new Date((await storedFeed())!.nextCheckAt).getTime()).toBeGreaterThan(Date.now());
  await page.reload();
  await expect(region(page, notice("a"))).toBeVisible();
});

test("links anywhere on the web, and drops any other kind of link while keeping the notice", async ({ page }) => {
  const elsewhere = notice("elsewhere", { severity: "important", link: { label: "Read more", url: "https://example.org/news" } });
  const script = notice("script", { link: { label: "Run this", url: "javascript:document.title='hacked'" } });
  await publish(page, elsewhere, script);
  await page.reload();
  await expect(region(page, elsewhere).getByRole("link", { name: "Read more (opens in a new tab)" })).toHaveAttribute("href", "https://example.org/news");

  await region(page, elsewhere).getByRole("button", { name: "Dismiss" }).click();
  await expect(region(page, script)).toBeVisible();
  await expect(region(page, script).getByRole("link")).toHaveCount(0);
  await expect(page.getByText("Run this")).toHaveCount(0);
});

test("shows its text as plain text", async ({ page }) => {
  const html = notice("html", { body: "<img src=x onerror=\"document.title='hacked'\"> **bold**" });
  await publish(page, html);
  await page.reload();
  await expect(region(page, html)).toContainText("<img src=x");
  await expect(region(page, html).locator("img, strong")).toHaveCount(0);
  await expect(page).not.toHaveTitle("hacked");
});

test("passes over notices for other versions and past their expiry", async ({ page }) => {
  const notices = [notice("newer", { minVersion: "99.0.0" }), notice("older", { maxVersion: "0.0.1" }), notice("expired", { expiresAt: "2026-01-01T00:00:00Z" })];
  await publish(page, ...notices);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: /^Notice / })).toHaveCount(0);
});

test("takes a withdrawn notice away with the next answer", async ({ page }) => {
  await publish(page, notice("a"), notice("b", { severity: "important" }));
  await page.reload();
  await expect(region(page, notice("b"))).toBeVisible();
  await fakeAnnouncements([notice("a")]);
  await askAgain(page);
  await expect.poll(async () => (await storedFeed())?.items.map(({ id }) => id)).toEqual(["a"]);
  await page.reload();
  await expect(region(page, notice("b"))).toBeHidden();
  await expect(region(page, notice("a"))).toBeVisible();
});

test("changes nothing while the backend is down", async ({ page }) => {
  const kept = notice("kept");
  await publish(page, kept);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await fakeAnnouncements([], "down");
  await askAgain(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(region(page, kept)).toBeVisible();
  await page.goto("/applications");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(region(page, kept)).toBeVisible();
  expect((await storedFeed())?.items.map(({ id }) => id)).toEqual(["kept"]);
  expect(new Date((await storedFeed())!.nextCheckAt).getTime()).toBeGreaterThan(Date.now());
  expect(errors).toEqual([]);
});

test("floats over the page, leaving the sidebar to the update notice, and stays within reach", async ({ page, context, baseURL }) => {
  const security = notice("security", { severity: "security", body: "x".repeat(500) });
  await publish(page, security);
  for (const [key, value] of [["latestVersion", "99.0.0"], ["latestVersionUrl", "https://github.com/AienTech/dossier/releases/tag/v99.0.0"]]) {
    await sql(`INSERT INTO "Setting" (key, value, "updatedAt") VALUES ($1, $2, now())`, [key, value]);
  }

  await page.goto("/");
  await expect(region(page, security)).toBeVisible();
  await expect(page.locator("aside").getByRole("region", { name: "Dossier 99.0.0 is out" })).toBeVisible();
  await expect(page.locator("aside").getByRole("region", { name: security.title })).toHaveCount(0);
  await expect(region(page, security)).toBeInViewport({ ratio: 1 });
  await expectAccessibleNotice(page);

  // With the sidebar collapsed, it's the same card.
  await context.addCookies([{ name: "dossier_sidebar", value: "collapsed", url: baseURL! }]);
  await page.goto("/");
  await expect(region(page, security)).toBeInViewport({ ratio: 1 });
  await context.clearCookies({ name: "dossier_sidebar" });

  // On a short window it scrolls by itself, and on a narrow one it fits.
  for (const size of [{ width: 1400, height: 320 }, { width: 400, height: 700 }]) {
    await page.setViewportSize(size);
    await page.goto("/");
    const box = (await region(page, security).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(box.height).toBeLessThanOrEqual(size.height);
    const dismiss = region(page, security).getByRole("button", { name: "Dismiss" });
    await dismiss.scrollIntoViewIfNeeded();
    await expect(dismiss).toBeInViewport();
  }

  await region(page, security).getByRole("button", { name: "Dismiss" }).click();
  await expect(region(page, security)).toBeHidden();
  await expect(page.locator("main")).toBeFocused();
});

// Last, since a backend that never answers holds the check for its 10-second timeout.
test("doesn't wait for a backend that doesn't answer", async ({ page }) => {
  const kept = notice("kept");
  await publish(page, kept);
  await fakeAnnouncements([], "silent");
  await askAgain(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(region(page, kept)).toBeVisible();
  await page.goto("/applications");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(region(page, kept)).toBeVisible();
  expect((await storedFeed())?.items.map(({ id }) => id)).toEqual(["kept"]);
});
