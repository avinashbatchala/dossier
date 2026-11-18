import { expect, test } from "@playwright/test";

import { resetData } from "./support";

// The profile end to end (E4): basics, skills and languages, a new role with
// a skill attached, all kept after a reload and shown on the base resume.
test.beforeAll(resetData);

test("fills in the profile, keeps it and shows it on the base resume", async ({ page }) => {
  await page.goto("/profile");
  await page.getByLabel("Full name").fill("John Doe");
  await page.getByLabel("City").fill("Utrecht");
  await page.getByLabel("City").blur();
  await expect(page.getByText("Saved just now")).toBeVisible();

  await page.getByRole("navigation", { name: "Profile sections" }).getByRole("link", { name: /^Skills/ }).click();
  await page.getByLabel("Add a skill").fill("Accessibility");
  await page.getByLabel("Add a skill").press("Enter");
  await expect(page.getByRole("list", { name: "Your skills" })).toContainText("Accessibility");
  await page.getByRole("navigation", { name: "Profile sections" }).getByRole("link", { name: /^Languages/ }).click();
  await page.getByLabel("Language", { exact: true }).fill("French");
  await page.getByLabel("Language", { exact: true }).press("Enter");
  await expect(page.getByLabel("French level")).toBeVisible();

  await page.getByRole("navigation", { name: "Profile sections" }).getByRole("link", { name: /Experience/ }).click();
  await page.getByRole("button", { name: "+ Add a role" }).click();
  await expect(page.getByLabel("Role", { exact: true })).toBeFocused();
  await page.getByLabel("Role", { exact: true }).fill("Design Lead");
  await page.getByLabel("Company", { exact: true }).fill("Acme Payments");
  await page.getByLabel("About the company or role").fill("Payouts for online marketplaces, 60 people");
  await page.getByLabel("What you did").fill("Led the redesign of the payout flow\nSet up the design system");
  await page.getByRole("group", { name: "Skills you used here" }).getByRole("button", { name: "Accessibility" }).click();
  await page.getByLabel("What you did").blur();
  await expect(page.getByText("Saved just now")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: /Design Lead.*Acme Payments/ })).toBeVisible();
  // How many tailored resumes use each role (E33-2): the demo application's resume has the others.
  await expect(page.getByRole("button", { name: /Design Lead.*Acme Payments/ })).toContainText("2 lines · not used in a resume yet");
  await expect(page.getByRole("button", { name: /^Senior Product Designer/ })).toContainText("3 lines · used in 1 resume");
  await page.getByRole("button", { name: /^Senior Product Designer/ }).click();
  await expect(page.getByRole("button", { name: /^Senior Product Designer/, expanded: true })).toContainText("Used in 1 of 1 resume");
  await page.getByRole("navigation", { name: "Profile sections" }).getByRole("link", { name: /Basics/ }).click();
  await expect(page.getByLabel("Full name")).toHaveValue("John Doe");

  await page.goto("/resume");
  const resume = page.getByRole("article", { name: "Resume" });
  await expect(resume).toContainText("John Doe");
  await expect(resume).toContainText("Acme Payments");
  // The line about the company, in italics under the role's title (#257).
  await expect(resume.getByText("Payouts for online marketplaces, 60 people")).toHaveCSS("font-style", "italic");
  await expect(resume).toContainText("Led the redesign of the payout flow");
});

test("puts skills in groups and prints a line per group on the base resume (#280)", async ({ page }) => {
  await page.goto("/profile?section=skills");
  await page.getByRole("button", { name: "+ New group" }).click();
  await page.getByLabel("Name of the new group").fill("Tools");
  await page.getByLabel("Name of the new group").press("Enter");
  await page.getByLabel("Add to Tools").fill("Ahrefs");
  await page.getByLabel("Add to Tools").press("Enter");
  await expect(page.getByRole("list", { name: "Skills in Tools" })).toContainText("Ahrefs");
  await page.getByRole("button", { name: "Figma: move it, or change its group" }).click();
  await page.getByRole("menuitemradio", { name: "Tools" }).click();
  await expect(page.getByRole("list", { name: "Skills in Tools" })).toContainText("Figma");
  await expect(page.getByText("Saved just now")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("list", { name: "Skills in Tools" })).toContainText("Figma");
  await page.goto("/resume");
  const skills = page.getByRole("article", { name: "Resume" }).locator('[data-unit="skills"] p');
  await expect(skills.last()).toHaveText("Tools: Figma · Ahrefs");
  await expect(skills.last().locator("strong")).toHaveText("Tools:");

  // The order is yours, from a skill's menu, and the resume follows (public issue 62).
  await page.goto("/profile?section=skills");
  await page.getByRole("button", { name: "Ahrefs: move it, or change its group" }).click();
  await page.getByRole("menuitem", { name: "Move left" }).click();
  await expect(page.getByText("In your own order, which tailored resumes keep.")).toBeVisible();
  await expect(page.getByText("Saved just now")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("list", { name: "Skills in Tools" })).toHaveText(/Ahrefs.*Figma/);
  await page.goto("/resume");
  await expect(skills.last()).toHaveText("Tools: Ahrefs · Figma");
});

test("adds a project with its skills and shows it on the base resume (PRO-13)", async ({ page }) => {
  await page.goto("/profile?section=projects");
  await page.getByRole("button", { name: "+ Add a project" }).click();
  await expect(page.getByLabel("Project", { exact: true })).toBeFocused();
  await page.getByLabel("Project", { exact: true }).fill("Churn predictor");
  await page.getByLabel("Link", { exact: true }).fill("https://github.com/jane/churn");
  await page.getByLabel("What you did").fill("Trained a model on two years of usage data\nShipped a dashboard the support team uses daily");
  await page.getByRole("group", { name: "Skills you used here" }).getByRole("button", { name: "Figma" }).click();
  await page.getByLabel("What you did").blur();
  await expect(page.getByText("Saved just now")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: /Churn predictor.*github\.com\/jane\/churn/ })).toBeVisible();

  await page.goto("/resume");
  const resume = page.getByRole("article", { name: "Resume" });
  await expect(resume.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(resume).toContainText("Churn predictor, github.com/jane/churn");
  await expect(resume).toContainText("Shipped a dashboard the support team uses daily");
});
