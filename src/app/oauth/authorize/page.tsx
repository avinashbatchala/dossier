import type { Metadata } from "next";

import { BrandMark } from "@/components/brand-mark";
import { verifySession } from "@/lib/auth/session";

import { Consent } from "./consent";
import { checkAuthorizeRequest } from "./request";

export const metadata: Metadata = { title: "Connect an app" };

/**
 * Claude, or another MCP app (#281), asks to use Dossier through the connector (#221, src/app/api/mcp).
 * Signed-out visitors sign in first: the proxy sends them to /login and back.
 */
export default async function AuthorizePage({ searchParams }: PageProps<"/oauth/authorize">) {
  await verifySession();
  const params = await searchParams;
  const checked = await checkAuthorizeRequest(params);
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-8 py-12">
      <div className="flex w-full max-w-[460px] flex-col gap-6">
        <div className="flex items-center gap-3">
          <BrandMark className="size-10" />
          <h1 className="font-serif text-[26px] font-medium tracking-[-0.01em]">
            Connect {"error" in checked ? "an app" : checked.clientName} to Dossier
          </h1>
        </div>
        {"error" in checked ? (
          <p role="alert" className="rounded-control bg-danger-surface px-3 py-2 text-sm text-error">
            {checked.error}
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-3 text-sm leading-[1.6] text-pretty">
              <p>
                <strong>{checked.clientName}</strong> wants to use your Dossier. Once you allow it, it can:
              </p>
              <ul className="list-disc pl-5 text-muted">
                <li>search for jobs with your job source, and score postings against your profile</li>
                <li>read your profile and your applications, with their resumes and cover letters, but not your contact details or notes</li>
                <li>save applications it writes for you as drafts, and change their status</li>
              </ul>
              <p className="text-muted">
                It can never send an application or an email, or delete anything. Allow it only if you&apos;ve just added Dossier to{" "}
                {checked.clientName} yourself: it sends you back to <strong className="text-ink">{new URL(checked.redirectUri).host}</strong>.
                Disconnect every app in Settings → MCP connector at any time.
              </p>
            </div>
            <Consent
              request={{
                client_id: checked.clientId,
                redirect_uri: checked.redirectUri,
                code_challenge: checked.codeChallenge,
                code_challenge_method: one(params.code_challenge_method),
                state: checked.state,
                resource: checked.resource,
              }}
            />
          </>
        )}
      </div>
    </main>
  );
}
