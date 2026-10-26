"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { answerConnector } from "./actions";

export type ConsentRequest = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
  resource: string;
};

/** Allow and Deny: both send the browser back to Claude. */
export function Consent({ request }: { request: ConsentRequest }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const answer = (allow: boolean) =>
    startTransition(async () => {
      const result = await answerConnector({ ...request, allow });
      if (!result.ok) return setError(result.error);
      window.location.assign(result.data.url);
    });

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-control bg-danger-surface px-3 py-2 text-meta text-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="button" aria-disabled={pending || undefined} onClick={() => !pending && answer(true)}>
          {pending ? "Connecting…" : "Allow"}
        </Button>
        <Button type="button" variant="secondary" aria-disabled={pending || undefined} onClick={() => !pending && answer(false)}>
          Deny
        </Button>
      </div>
    </div>
  );
}
