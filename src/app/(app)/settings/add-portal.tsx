"use client";

import { useId, useRef, useState } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { countryName } from "@/lib/job-search/countries";
import type { JobSearchSettingsView } from "@/lib/job-search/sources";
import type { PortalPreview } from "@/lib/portals/installed";

import { installPortalConfig, previewPortal } from "./actions";

type Read =
  | { status: "preview"; preview: PortalPreview; origin: "file" | "link"; originUrl: string | null }
  | { status: "refused"; problems: string[] }
  | null;

/** "Mostly tech", "Any kind of job": a config's kinds of work. */
const KIND_NAMES: Record<string, string> = { tech: "Mostly tech", any: "Any kind of job" };

const listed = (items: readonly string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : (items[0] ?? ""));

/**
 * Add portal (E23-3): a portal config from a file or a link. Before it's
 * installed, it shows what the portal is, every host it reaches, what it asks
 * for and its terms, and that nobody reviewed it. A config that isn't one is
 * refused, saying what's wrong.
 */
export function AddPortal({ onInstalled }: { onInstalled: (view: JobSearchSettingsView) => void }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<Read>(null);
  const [installing, setInstalling] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const headingId = useId();

  const readConfig = async (input: { text: string } | { url: string }, origin: "file" | "link", originUrl: string | null) => {
    setReading(true);
    setRead(null);
    const result = toastResult(await previewPortal(input));
    setReading(false);
    if (!result.ok) return;
    setRead(result.data.ok ? { status: "preview", preview: result.data.preview, origin, originUrl } : { status: "refused", problems: result.data.problems });
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    // A config is small; anything much bigger isn't one, and isn't sent.
    if (file.size > 400 * 1024) return setRead({ status: "refused", problems: ["It's bigger than a portal config can be (200 KB)."] });
    await readConfig({ text: await file.text() }, "file", null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const install = async (shown: Extract<Read, { status: "preview" }>) => {
    setInstalling(true);
    const result = toastResult(await installPortalConfig({ text: shown.preview.text, origin: shown.origin, originUrl: shown.originUrl }));
    setInstalling(false);
    if (!result.ok) return;
    onInstalled(result.data);
    setRead(null);
    setLink("");
    setOpen(false);
  };

  if (!open) {
    return (
      <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>
        Add portal
      </Button>
    );
  }

  return (
    <Card className="flex w-full flex-col gap-5">
      <section aria-labelledby={headingId} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 id={headingId} className="text-[15px] font-medium">
            Add portal
          </h3>
          <p className="text-meta text-pretty text-muted">
            A portal config describes a job portal: where Dossier asks for postings and what it sends there. Add one from a file or a link; you&apos;ll see what it
            does before it&apos;s added.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <input ref={fileInput} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => void readFile(event.target.files?.[0])} />
          <Button variant="secondary" aria-disabled={reading || undefined} onClick={() => !reading && fileInput.current?.click()}>
            Choose a file
          </Button>
          <form
            className="flex min-w-[260px] flex-1 flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!reading && link.trim()) void readConfig({ url: link.trim() }, "link", link.trim());
            }}
          >
            <Input label="Or a link to one" type="url" placeholder="https://…/portal.json" value={link} onChange={(event) => setLink(event.target.value)} className="min-w-[220px] flex-1" />
            <Button type="submit" variant="secondary" aria-disabled={reading || !link.trim() || undefined}>
              {reading ? "Reading…" : "Read it"}
            </Button>
          </form>
        </div>

        <div role="status" className="empty:hidden">
          {read?.status === "refused" && (
            <div className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
              <p className="font-medium">This isn&apos;t a portal config Dossier can use:</p>
              <ul className="mt-1 list-disc pl-5">
                {read.problems.slice(0, 8).map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {read?.status === "preview" && <Preview shown={read} installing={installing} onInstall={() => void install(read)} onCancel={() => setRead(null)} />}

        <Button variant="secondary" size="sm" className="self-start" onClick={() => (setOpen(false), setRead(null))}>
          Close
        </Button>
      </section>
    </Card>
  );
}

/** What a config does, before it's installed. */
function Preview({ shown, installing, onInstall, onCancel }: { shown: Extract<Read, { status: "preview" }>; installing: boolean; onInstall: () => void; onCancel: () => void }) {
  const { preview } = shown;
  const fact = (term: string, value: React.ReactNode) => (
    <>
      <dt className="font-medium">{term}</dt>
      <dd className="text-pretty text-muted">{value}</dd>
    </>
  );
  return (
    <div className="flex flex-col gap-4 rounded-card border border-line-card p-5">
      <div className="flex flex-col gap-1">
        <h4 className="font-serif text-section">
          {preview.name} <span className="text-meta text-muted">version {preview.version}</span>
        </h4>
        {preview.description && <p className="text-sm text-pretty text-muted">{preview.description}</p>}
      </div>
      <dl className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-[150px_1fr]">
        {fact("Countries", preview.countries === null ? "Every country" : listed(preview.countries.map(countryName)))}
        {fact("Kinds of work", listed(preview.kinds.map((kind) => KIND_NAMES[kind] ?? kind)))}
        {fact(
          "It reaches",
          <ul className="flex flex-col">
            {preview.hosts.map((host) => (
              <li key={host} className="font-mono text-[13px]">
                {host}
              </li>
            ))}
          </ul>,
        )}
        {fact("It asks for", preview.asks.length > 0 ? listed(preview.asks) : "Nothing: no key or account")}
        {fact(
          "Its terms",
          preview.termsUrl ? (
            <a href={preview.termsUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">
              {new URL(preview.termsUrl).host}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            "No link to its terms"
          ),
        )}
      </dl>
      {!preview.reviewed && (
        <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
          <span className="font-medium">Not reviewed.</span> Nobody has checked this config. Your searches, and any key you give it, go to the hosts above, and
          its terms are yours to check. Add it only if you trust where it came from.
        </p>
      )}
      {preview.installedVersion && <p className="text-meta text-muted">Version {preview.installedVersion} is added already: this replaces it.</p>}
      <div className="flex flex-wrap gap-2.5">
        <Button aria-disabled={installing || undefined} onClick={() => !installing && onInstall()}>
          {installing ? "Adding…" : `Add ${preview.name}`}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
