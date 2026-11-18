import { expect, test, type Page } from "@playwright/test";

import { resetData } from "./support";

// Profile owns its sections (#335): the list there is the order new resumes
// start with, and the Base resume shows the same one.
test.beforeAll(async () => {
  await resetData();
});

const nav = (page: Page) => page.getByRole("navigation", { name: "Profile sections" });
// Both wait for the page first: it streams in after navigating.
const rows = async (page: Page) => {
  const links = nav(page).getByRole("listitem").getByRole("link");
  await expect(links.first()).toBeVisible();
  // The label, after the mark (E33-1).
  return links.evaluateAll((all) => all.map((link) => link.querySelector(".truncate")?.textContent ?? ""));
};
const headings = async (page: Page) => {
  const all = page.getByRole("article", { name: "Resume" }).getByRole("heading", { level: 2 });
  await expect(all.first()).toBeVisible();
  return all.allTextContents();
};

test("moves any section on Profile, by button and by dragging, and resumes follow", async ({ page }) => {
  await page.goto("/profile");
  expect((await rows(page))[0]).toBe("Basics");
  expect((await rows(page)).at(-1)).toBe("Facts about me");

  await page.goto("/resume");
  const before = await headings(page);
  expect(before.indexOf("Experience")).toBeLessThan(before.indexOf("Skills"));

  // Basics isn't a heading on a resume: it moves in the list and nowhere else.
  await page.goto("/profile");
  await nav(page).getByRole("link", { name: /^Basics/ }).hover();
  await page.getByRole("button", { name: "Move “Basics” down" }).click();
  await expect.poll(async () => (await rows(page))[1]).toBe("Basics");
  await expect(page.getByText("Saved just now")).toBeVisible();
  await page.goto("/resume");
  expect(await headings(page)).toEqual(before);

  // Skills, by dragging, above Experience.
  await page.goto("/profile");
  const row = (name: RegExp) => nav(page).locator("li", { has: page.getByRole("link", { name }) });
  const from = (await row(/^Skills/).getByTitle("Drag to reorder").boundingBox())!;
  const to = (await row(/^Experience/).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await rows(page)).indexOf("Skills")).toBeLessThan((await rows(page)).indexOf("Experience"));
  await expect(page.getByText("Saved just now")).toBeVisible();

  await page.reload();
  expect((await rows(page)).indexOf("Skills")).toBeLessThan((await rows(page)).indexOf("Experience"));
  await page.goto("/resume");
  const after = await headings(page);
  expect(after.indexOf("Skills")).toBeLessThan(after.indexOf("Experience"));

  // And the other way round: the Base resume's list is the same one.
  await page.goto("/resume?panel=sections");
  await page.getByRole("button", { name: "Move “Experience” up" }).click();
  await expect.poll(async () => (await headings(page)).indexOf("Experience")).toBeLessThan((await headings(page)).indexOf("Skills"));
  await page.waitForLoadState("networkidle");
  await page.goto("/profile");
  expect((await rows(page)).indexOf("Experience")).toBeLessThan((await rows(page)).indexOf("Skills"));
  expect((await rows(page))[1]).toBe("Basics");
});
