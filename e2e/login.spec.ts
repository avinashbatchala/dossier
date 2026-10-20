import { expect, test } from "@playwright/test";

import { PASSWORD, sql } from "./support";

// Signing in (AUTH-1, AUTH-4) and the backoff after failures (E3), signed out.
test.use({ storageState: { cookies: [], origins: [] } });

test.afterEach(async () => {
  await sql(`DELETE FROM "LoginThrottle"`);
});

test("sends a signed-out visitor to sign in, then on to where they were going", async ({ page }) => {
  await page.goto("/applications");
  await expect(page).toHaveURL("/login?next=%2Fapplications");
  await page.getByLabel("Password", { exact: true }).fill("not it");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That's not the password set on the server. Try again.")).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/applications");
  await expect(page.getByRole("heading", { level: 1, name: "Applications" })).toBeVisible();
});

test("slows down guessing after five wrong passwords", async ({ page }) => {
  await page.goto("/login");
  const password = page.getByLabel("Password", { exact: true });
  for (let attempt = 1; attempt <= 5; attempt++) {
    await password.fill(`guess ${attempt}`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("That's not the password set on the server. Try again.")).toBeVisible();
  }
  // Even the right password has to wait now.
  await password.fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/^Too many attempts/)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

// Before the page's scripts run, or with them off, the browser submits the
// form itself (#187): it must post, never put the password in the URL. The
// app's pages stream in behind loading.tsx and need scripts for that, so
// these check the signed-in sidebar rather than the page.
test.describe("without scripts", () => {
  test.use({ javaScriptEnabled: false });

  test("posts the password and still signs in", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Password", { exact: true }).fill("not it");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("That's not the password set on the server. Try again.")).toBeVisible();
    // No query string: the password went in the request's body.
    await expect(page).toHaveURL("/login");

    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("goes on to where the visitor was going", async ({ page }) => {
    await page.goto("/applications");
    await expect(page).toHaveURL("/login?next=%2Fapplications");
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/applications");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
});

test("a submit before the scripts have loaded posts too, and the page it lands on works", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));

  // As on a slow connection: the first page's scripts never arrive.
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  await page.goto("/login");
  await page.unroute("**/_next/static/**/*.js");
  errors.length = 0;

  await page.getByLabel("Password", { exact: true }).fill("not it");
  const posted = page.waitForRequest((request) => request.isNavigationRequest() && request.method() === "POST");
  await page.getByRole("button", { name: "Sign in" }).click();
  await posted;
  await expect(page).toHaveURL("/login");
  const error = page.getByText("That's not the password set on the server. Try again.");
  await expect(error).toBeVisible();

  // This time the scripts load, and typing clears the error as usual.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Password", { exact: true }).fill("x");
  await expect(error).toBeHidden();
  expect(errors).toEqual([]);
});
