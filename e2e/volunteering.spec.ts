import { expect, test } from "@playwright/test";

import { resetData } from "./support";

// Volunteering (#294): volunteering roles have their own page in the profile
// and their own heading on resumes, apart from the paid roles.
test.beforeAll(async () => {
  await resetData();
});

test("moves a role to Volunteering, its own page and its own heading on the base resume", async ({ page }) => {
  await page.goto("/profile?section=experience");
  await page.getByRole("button", { name: /^UX Designer/, expanded: false }).click();
  await page.getByRole("button", { name: "Move to Volunteering" }).click();
  await expect(page.getByRole("button", { name: /^UX Designer/ })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Profile sections" }).getByRole("link", { name: /^Volunteering/ }).click();
  await page.getByRole("button", { name: /^UX Designer.*Sep 2015 – May 2018/, expanded: false }).click();
  await expect(page.getByRole("textbox", { name: "Organisation" })).toHaveValue("Studio Brik");
  await expect(page.getByRole("button", { name: /Northwind/ })).toHaveCount(0);

  await page.goto("/resume");
  const resume = page.getByRole("article", { name: "Resume" });
  const volunteering = resume.locator("section", { has: page.getByRole("heading", { name: "Volunteering" }) });
  await expect(volunteering).toContainText("UX Designer, Studio Brik");
  const experience = resume.locator("section", { has: page.getByRole("heading", { name: "Experience" }) });
  await expect(experience).toContainText("Northwind Logistics");
  await expect(experience).not.toContainText("Studio Brik");
});
