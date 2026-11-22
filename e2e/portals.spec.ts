import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { fakeCatalog, resetData, sql } from "./support";

// Add portal (E23-3): a portal config from a file, shown before it's added,
// searched like a built-in against the fake portals (e2e/fake-jobs.mts), and
// removed again, leaving what it found in Positions.

test.beforeAll(resetData);
test.afterAll(async () => {
  await sql(`DELETE FROM "InstalledPortal"`);
  await sql(`DELETE FROM "PortalCatalog"`);
  await fakeCatalog({ portals: [], withdrawn: [] });
});

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id)).toEqual([]);
}

const config = {
  format: 1,
  id: "E2E_BOARD",
  name: "Canal Board",
  version: "1.0.0",
  description: "Design jobs along the canals.",
  tag: "Free, no key",
  termsUrl: "https://board.example/terms",
  countries: null,
  kinds: ["any"],
  radius: false,
  hosts: ["api.board.example"],
  base: "https://api.board.example",
  kind: "json",
  search: {
    url: "{base}/jobs",
    params: [{ name: "q", value: "{keywords}" }],
    items: "jobs",
    posting: { id: "id", title: "title", company: "company", place: "city", url: "link" },
  },
  test: { keywords: "designer", country: "nl" },
};

const portalOn = () =>
  expect.poll(async () => (JSON.parse((await sql<{ value: string }>(`SELECT value FROM "Setting" WHERE key = 'portals'`))[0]?.value ?? "{}") as Record<string, { on: boolean }>).E2E_BOARD?.on);

test("adds a portal from a file, shows what it reaches first, searches it, and removes it", async ({ page }) => {
  await page.goto("/settings?section=jobs");
  await page.getByRole("button", { name: "Add portal" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "canal-board.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(config)) });

  // Before it's added: what it is, every host it reaches, what it asks for, its terms, and that nobody reviewed it.
  await expect(page.getByRole("heading", { name: /Canal Board/ })).toBeVisible();
  await expect(page.getByText("api.board.example")).toBeVisible();
  await expect(page.getByText("Nothing: no key or account")).toBeVisible();
  await expect(page.getByRole("note").filter({ hasText: "Not reviewed." })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Add Canal Board" }).click();
  await expect(page.getByText("Canal Board added. Switch it on to search it.")).toBeVisible();
  await expect(page.getByText("Added from a file · Not reviewed")).toBeVisible();

  await page.getByRole("switch", { name: /^Canal Board/ }).click();
  await portalOn().toBe(true);
  await page.getByRole("button", { name: "Test connection to Canal Board" }).click();
  await expect(page.getByText(/^Connected/).last()).toBeVisible();

  // Searched with the built-ins switched on, its postings in Positions under its name.
  await page.goto("/jobs?q=designer&where=Rotterdam&country=nl");
  await page.getByRole("search", { name: "Search postings" }).getByRole("button", { name: "Search" }).click();
  const list = page.getByRole("list", { name: "Postings" });
  await expect(list.getByRole("button", { name: /^Service Designer/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Portal: / }).click();
  await expect(page.getByRole("menuitemradio", { name: "Canal Board" })).toHaveCount(1);
  await page.keyboard.press("Escape");

  // Removed: no longer searched, its posting stays.
  await page.goto("/settings?section=jobs");
  await page.getByRole("button", { name: "Remove portal Canal Board" }).click();
  await page.getByRole("alertdialog", { name: "Remove Canal Board?" }).getByRole("button", { name: "Remove portal" }).click();
  await expect(page.getByText("Canal Board removed. What it found stays in Positions.")).toBeVisible();
  await expect(page.getByRole("switch", { name: /^Canal Board/ })).toHaveCount(0);
  await page.goto("/jobs");
  await expect(list.getByRole("button", { name: /^Service Designer/ })).toBeVisible();
});

/** Companies' own boards, asked once for each board in a list (E23, #238). */
const boardsConfig = {
  format: 1,
  id: "E2E_BOARDS",
  name: "Harbour Boards",
  version: "1.0.0",
  description: "Companies' own job boards.",
  tag: "Companies you choose",
  termsUrl: "https://boards.example/terms",
  countries: null,
  kinds: ["any"],
  radius: false,
  hosts: ["api.boards.example"],
  base: "https://api.boards.example",
  fields: [{ name: "boards", type: "list", label: "Boards", help: "A board's name or link." }],
  kind: "json",
  search: {
    url: "{base}/{each}/jobs",
    each: { field: "boards" },
    keepMinutes: 30,
    localFilter: true,
    items: "jobs",
    posting: { id: "id", title: "title", company: { template: "{each|title}" }, place: "location", remote: "remote", url: "link", description: "text", complete: "description" },
  },
  test: { keywords: "designer", country: "nl" },
};

test("searches each company's board in a list, matching on the server and naming a board it couldn't read (E23)", async ({ page }) => {
  await sql(`DELETE FROM "InstalledPortal"`);
  await page.goto("/settings?section=jobs");
  await page.getByRole("button", { name: "Add portal" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "harbour-boards.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(boardsConfig)) });
  await expect(page.getByText("Boards", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add Harbour Boards" }).click();
  await expect(page.getByText("Harbour Boards added. Switch it on to search it.")).toBeVisible();
  await page.getByRole("switch", { name: /^Harbour Boards/ }).click();

  // One a line, a name or a link; kept as names.
  const boards = page.getByRole("textbox", { name: "Boards", exact: true });
  await boards.fill("harbour-works\nhttps://boards.example/nope");
  await boards.blur();
  await expect
    .poll(async () => (JSON.parse((await sql<{ value: string }>(`SELECT value FROM "Setting" WHERE key = 'portals'`))[0]?.value ?? "{}") as Record<string, { fields: Record<string, string> }>).E2E_BOARDS?.fields.boards)
    .toBe("harbour-works\nnope");
  await expectAccessible(page);
  await page.getByRole("button", { name: "Test connection to Harbour Boards" }).click();
  await expect(page.getByText("Harbour Boards couldn't read nope. Check it; the rest work.")).toBeVisible();

  // Matched on the server: the designer in Rotterdam, not the one for the US; the board it couldn't read is named.
  await page.goto("/jobs?q=designer&where=Rotterdam&country=nl");
  await page.getByRole("search", { name: "Search postings" }).getByRole("button", { name: "Search" }).click();
  const list = page.getByRole("list", { name: "Postings" });
  await expect(list.getByRole("button", { name: /^Interaction Designer/ })).toHaveCount(1, { timeout: 30_000 });
  // Hovering the progress shows each portal.
  await page.getByText(/^\d+ of \d+ portals? answered/).hover();
  await expect(page.getByRole("list", { name: "Each portal" }).getByRole("listitem").filter({ hasText: "Harbour Boards" })).toContainText("1 posting · Couldn't read nope.");
});

/** The same portal as the catalog lists it, at a version, reaching these hosts. */
const listed = (version: string, hosts = ["api.board.example"]) => {
  const reviewed = { ...config, version, hosts };
  return { id: reviewed.id, version, name: reviewed.name, description: reviewed.description, countries: null, kinds: ["any"], access: "public-feed", needsKey: false, builtIn: false, termsUrl: reviewed.termsUrl, config: reviewed };
};

/** Makes the catalog due, so the next page reads it again (at most once a day otherwise). */
async function catalogDue(page: Page) {
  await sql(`UPDATE "PortalCatalog" SET "readAt" = now() - interval '1 hour', "nextReadAt" = now() - interval '1 minute'`);
  // The read runs after a page is sent; the page after it shows what it read.
  await page.goto("/settings?section=jobs");
}

test("adds a reviewed portal from the catalog, updates it once its new host is approved, and pauses it when it's withdrawn (E23)", async ({ page }) => {
  await sql(`DELETE FROM "InstalledPortal"`);
  await fakeCatalog({ portals: [listed("1.0.0")], withdrawn: [] });
  // Browse reads the catalog again at most once a minute; the pages before read the empty one.
  await sql(`UPDATE "PortalCatalog" SET "readAt" = now() - interval '1 hour'`);
  await page.goto("/settings?section=jobs");
  await page.getByRole("button", { name: "Browse portals" }).click();
  const list = page.getByRole("list", { name: "Portals in the catalog" });
  await expect(list.getByRole("listitem").filter({ hasText: "Canal Board" })).toContainText("Canal BoardReviewedPublic feedFree");
  await expectAccessible(page);
  await list.getByRole("button", { name: "Add Canal Board" }).click();
  await expect(list.getByText("api.board.example")).toBeVisible();
  await list.getByRole("button", { name: "Add Canal Board" }).click();
  await expect(page.getByText("Canal Board added. Switch it on to search it.")).toBeVisible();
  await expect(page.getByText("Added from the catalog · Reviewed")).toBeVisible();

  // A newer version that reaches a new host waits for the user's approval of it.
  await fakeCatalog({ portals: [listed("1.1.0", ["api.board.example", "cdn.board.example"])], withdrawn: [] });
  await catalogDue(page);
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("Update available: version 1.0.0 → 1.1.0")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  const update = page.getByRole("button", { name: "Update Canal Board" });
  await expect(update).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("checkbox", { name: /Let it reach cdn\.board\.example/ }).check();
  await update.click();
  await expect(page.getByText("Canal Board updated to version 1.1.0.")).toBeVisible();
  expect(await sql(`SELECT version FROM "InstalledPortal" WHERE id = 'E2E_BOARD'`)).toEqual([{ version: "1.1.0" }]);

  // Withdrawn: paused, saying why, until the user keeps it.
  await fakeCatalog({ portals: [], withdrawn: [{ id: "E2E_BOARD", reason: "Its terms no longer allow it.", withdrawnAt: "2026-11-16T09:00:00Z" }] });
  await catalogDue(page);
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("Withdrawn from the catalog, so it's paused:", { exact: false })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole("note").filter({ hasText: "Its terms no longer allow it." })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Keep searching Canal Board" }).click();
  await expect(page.getByText("Canal Board is searched again.")).toBeVisible();
  await expect(page.getByText(/Withdrawn from the catalog/)).toHaveCount(0);
});
