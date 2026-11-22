"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ActionError, publicAction } from "@/lib/action";
import { clientIp } from "@/lib/auth/client-ip";
import { knownBrowser, rememberBrowser } from "@/lib/auth/known-browser";
import { startLoginAttempt } from "@/lib/auth/login-throttle";
import { safeNextPath } from "@/lib/auth/next-path";
import { passwordMatches, startSession } from "@/lib/auth/session";
import { pausedForNewBrowsersMessage, tooManyAttemptsMessage } from "@/lib/auth/throttle";
import { isDesktopClient } from "@/lib/desktop-client";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";

import { loginMessages } from "./messages";

/**
 * Signs in with the password that DOSSIER_PASSWORD is a hash of (PRD AUTH-1, AUTH-4).
 * Attempts are rate-limited per IP and globally, or per IP and browser for a
 * browser that signed in before (AUTH-5, #334). Returns
 * where to go next: the requested page if it's on this site, or the dashboard.
 */
export const signIn = publicAction(
  z.object({
    password: z.string(),
    remember: z.boolean(),
    next: z.string().optional(),
  }),
  async ({ password, remember, next }, { toast }) => {
    if (!password) throw new ActionError(loginMessages.empty);

    // Counted before the password is checked, so a burst can't get past the limit (#329).
    const attempt = await startLoginAttempt(prisma, { ip: clientIp(await headers()), browser: await knownBrowser() });
    if (!attempt.allowed) {
      const message = attempt.limit === "everyone" ? pausedForNewBrowsersMessage : tooManyAttemptsMessage;
      throw new ActionError(message(attempt.waitMs));
    }
    if (!(await passwordMatches(password))) throw new ActionError(loginMessages.wrong);
    await attempt.succeeded();

    // The desktop app keeps its sign-in across launches (#359); a browser only when asked.
    await startSession({ persistent: remember || isDesktopClient((await headers()).get("user-agent")) });
    await rememberBrowser();
    const firstName = (await loadProfileName()).trim().split(/\s+/)[0] || "there";
    toast(`Welcome back, ${firstName}.`);
    return { redirectTo: safeNextPath(next) };
  },
);

/** What the sign-in form shows after a submit that `signInWithForm` handled. */
export type SignInFormState = { error: string } | null;

/**
 * `signIn` for the form's own submit, which the browser makes before the
 * page's scripts have run or when they're off (#187). It posts, so the
 * password never ends up in the URL. Goes on to the next page, or returns the
 * error for the page to show. There's no welcome toast this way.
 */
export async function signInWithForm(_previous: SignInFormState, form: FormData): Promise<SignInFormState> {
  const result = await signIn({
    password: text(form, "password"),
    remember: form.get("remember") === "on",
    next: text(form, "next") || undefined,
  });
  if (!result.ok) return { error: result.error };
  redirect(result.data.redirectTo);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
