"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { ArbeitsagenturNote } from "@/components/arbeitsagentur-note";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Country } from "@/lib/job-search/countries";
import type { JobSearchSettingsView, PortalFieldView, PortalView } from "@/lib/job-search/sources";
import type { CatalogPortalView } from "@/lib/portals/catalog";
import { ANYWHERE, guideFor, JOB_KINDS, JOB_SOURCES_HELP, needsKey, portalsFor, startsTicked, type JobKind } from "@/lib/setup/job-choices";

import { installFromCatalog, savePortalField, savePortalKey, setPortalOn, testPortal } from "../../(app)/settings/actions";
import { ChoiceCards } from "./choice-cards";
import { InstructionList } from "./instruction-list";

type Status = { state: "idle" } | { state: "checking" } | { state: "connected" } | { state: "failed"; message: string };

const fieldOf = (portal: PortalView, name: string): PortalFieldView | undefined => portal.fields.find((field) => field.name === name);

/** The kind of work the portals switched on suggest, when some are. */
function kindOf(view: JobSearchSettingsView): JobKind | null {
  const on = view.portals.filter((portal) => portal.on);
  if (on.length === 0) return null;
  return on.every((portal) => portal.kinds.includes("tech") && !portal.kinds.includes("any")) ? "tech" : "any";
}

/**
 * The guide's job search step (E21-3, E22-9): where the user looks and for
 * what kind of work, then every portal that covers it, several at once. A
 * free one goes on when it's ticked; one that needs a key, once its key
 * checks out; the Bundesagentur für Arbeit, once its note is accepted.
 * Until the market's catalog (E23-4), the portals are the built-ins.
 */
export function JobsStep({
  initial,
  countries,
  country,
  catalog = null,
}: {
  initial: JobSearchSettingsView;
  countries: readonly Country[];
  country: string;
  /** The catalog's reviewed portals not added yet (E23-4); null when it can't be reached. */
  catalog?: CatalogPortalView[] | null;
}) {
  const router = useRouter();
  const [where, setWhere] = useState(country || ANYWHERE);
  const [kind, setKind] = useState<JobKind | null>(kindOf(initial));
  const [busy, setBusy] = useState(false);
  const portals = portalsFor(initial.portals, where);
  // One that needs a list (companies' boards) is set up in Settings, where the list can be filled in.
  const fromCatalog = portalsFor(catalog ?? [], where).filter((entry) => entry.state === "available" && !entry.needsList);

  const switchOff = async (ids: readonly PortalView["id"][]) => {
    for (const portal of ids) if (!toastResult(await setPortalOn({ portal, on: false })).ok) return false;
    return true;
  };

  /** A catalog portal, added and switched on; one that needs a key then shows its key field. */
  const addFromCatalog = async (id: string) => toastResult(await installFromCatalog({ portal: id })).ok && toastResult(await setPortalOn({ portal: id, on: true })).ok;

  const chooseKind = async (next: JobKind) => {
    setKind(next);
    setBusy(true);
    try {
      if (next === "none") {
        // None for now: every portal goes off.
        if (await switchOff(initial.portals.filter((entry) => entry.on).map((entry) => entry.id))) router.refresh();
        return;
      }
      // With none on yet, the free ones for this kind of work start ticked.
      if (initial.portals.some((entry) => entry.on)) return;
      for (const portal of portals.filter((entry) => startsTicked(entry, next))) {
        if (!toastResult(await setPortalOn({ portal: portal.id, on: true })).ok) return;
      }
      // And the free reviewed ones from the catalog: added, then switched on; remote-only ones when looking for remote work.
      for (const entry of fromCatalog.filter((candidate) => !candidate.needsKey && candidate.kinds.includes(next) && (!candidate.remoteOnly || where === ANYWHERE))) {
        if (!(await addFromCatalog(entry.id))) return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lead font-medium">Where are you looking?</h2>
        <Select label="Country" value={where} onChange={(event) => setWhere(event.target.value)} className="max-w-[360px]">
          <option value={ANYWHERE}>Remote, anywhere</option>
          {countries.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
            </option>
          ))}
        </Select>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lead font-medium">What kind of work?</h2>
        <ChoiceCards label="What kind of work?" options={JOB_KINDS} value={kind} onChange={(next) => void chooseKind(next)} />
      </section>
      {kind && kind !== "none" && (
        <section className="flex flex-col gap-3" aria-busy={busy || undefined}>
          <h2 className="text-lead font-medium">Portals to search</h2>
          <p className="text-meta text-muted">
            Tick as many as you like: a search asks all of them, and the same job from several shows once. Your searches (keywords, place and filters) go to each
            portal you tick; nothing from your profile does.
          </p>
          <ul className="flex flex-col gap-3">
            {portals.map((portal) => (
              <li key={portal.id}>
                <PortalRow portal={portal} freehireHost={initial.freehire.host} onChange={() => router.refresh()} />
              </li>
            ))}
            {fromCatalog.map((entry) => (
              <li key={entry.id}>
                <CatalogRow entry={entry} onAdd={async () => (await addFromCatalog(entry.id)) && router.refresh()} />
              </li>
            ))}
          </ul>
          {catalog === null && <p className="text-meta text-muted">More portals in Settings → Job search later.</p>}
          <a href={JOB_SOURCES_HELP} target="_blank" rel="noopener noreferrer" className="self-start text-meta text-muted underline underline-offset-2 hover:text-ink">
            Which portal is for you? <span className="sr-only">(opens in a new tab)</span>
          </a>
        </section>
      )}
    </div>
  );
}

/** One portal: ticked when it's on, with what it needs to go on when it isn't yet. */
function PortalRow({ portal, freehireHost, onChange }: { portal: PortalView; freehireHost: string; onChange: () => void }) {
  const guide = guideFor(portal);
  const id = useId();
  // Ticked but not on yet: its key or note is still to come.
  const [opening, setOpening] = useState(false);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const ticked = portal.on || opening;
  const keyed = needsKey(portal);

  const test = async () => {
    setStatus({ state: "checking" });
    const result = toastResult(await testPortal({ portal: portal.id }));
    if (!result.ok) return setStatus({ state: "idle" });
    setStatus(result.data.connected ? { state: "connected" } : { state: "failed", message: result.data.message });
  };

  const tick = async (on: boolean) => {
    setStatus({ state: "idle" });
    if (!on) {
      setOpening(false);
      if (portal.on && toastResult(await setPortalOn({ portal: portal.id, on: false })).ok) onChange();
      return;
    }
    // A key or a note first; a free one goes on now, and is checked.
    if (keyed || (portal.consent && !portal.acceptedAt)) return setOpening(true);
    if (!toastResult(await setPortalOn({ portal: portal.id, on: true })).ok) return;
    onChange();
    await test();
  };

  const accept = async () => {
    // It stays ticked while the page catches up.
    const ok = toastResult(await setPortalOn({ portal: portal.id, on: true, accepted: true })).ok;
    if (ok) onChange();
    return ok;
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={ticked}
          onChange={(event) => void tick(event.target.checked)}
          aria-describedby={`${id}-about`}
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
            {portal.name}
            <span className="rounded-full bg-track px-2 py-0.5 text-xs font-normal text-ink">{portal.installed ? (portal.installed.reviewed ? "Reviewed" : "Not reviewed") : "Built in"}</span>
            <span className="rounded-full bg-track px-2 py-0.5 text-xs font-normal text-ink">{keyed ? "Needs a key" : "Free"}</span>
          </label>
          <p id={`${id}-about`} className="text-meta text-pretty text-muted">
            {guide.about} {guide.cost}
            {portal.id === "FREEHIRE" && freehireHost !== "freehire.me" ? ` This server searches ${freehireHost}.` : ""}
          </p>
        </div>
      </div>
      {ticked && !portal.on && portal.consent && !portal.acceptedAt && <ArbeitsagenturNote accepted={false} onAccept={accept} />}
      {ticked && keyed && (
        // It stays open, saying it works, while the page catches up.
        <KeyForm portal={portal} onConnected={onChange} />
      )}
      <div role="status" className="text-sm empty:hidden">
        {!keyed && status.state === "checking" && <p className="text-muted">Checking…</p>}
        {!keyed && status.state === "connected" && <p className="text-success">It works: Dossier can search {portal.name}.</p>}
        {!keyed && status.state === "failed" && <p className="rounded-card bg-warning-surface px-4 py-3 font-medium text-warning">{status.message}</p>}
      </div>
    </Card>
  );
}

/** A portal's key (and Adzuna's application ID), with how to get it, checked at once; it goes on once it works. */
function KeyForm({ portal, onConnected }: { portal: PortalView; onConnected: () => void }) {
  const guide = guideFor(portal);
  const savedAppId = fieldOf(portal, "appId");
  const [appId, setAppId] = useState(savedAppId?.type === "text" ? savedAppId.value : "");
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const keyField = fieldOf(portal, "key");
  const savedKey = keyField?.type === "secret" ? keyField.keyState : "none";

  const connect = async () => {
    setStatus({ state: "checking" });
    const steps = [
      ...(portal.id === "ADZUNA" ? [() => savePortalField({ portal: "ADZUNA", field: "appId", value: appId })] : []),
      ...(portal.id === "JSEARCH" ? [() => savePortalField({ portal: "JSEARCH", field: "host", value: "openwebninja" })] : []),
      ...(key.trim() ? [() => savePortalKey({ portal: portal.id, field: "key", change: { action: "set", value: key } })] : []),
    ];
    for (const step of steps) {
      if (!toastResult(await step()).ok) return setStatus({ state: "idle" });
    }
    const result = toastResult(await testPortal({ portal: portal.id }));
    if (!result.ok) return setStatus({ state: "idle" });
    if (!result.data.connected) return setStatus({ state: "failed", message: result.data.message });
    if (!toastResult(await setPortalOn({ portal: portal.id, on: true })).ok) return setStatus({ state: "idle" });
    setKey("");
    setStatus({ state: "connected" });
    onConnected();
  };

  return (
    <div className="flex flex-col gap-4 border-t border-line pt-4">
      <InstructionList steps={guide.steps} label={`Setting up ${portal.name}`} />
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (status.state !== "checking") void connect();
        }}
      >
        {portal.id === "ADZUNA" && <Input label="Application ID" autoComplete="off" value={appId} onChange={(event) => setAppId(event.target.value)} />}
        <Input
          label={portal.id === "ADZUNA" ? "Application key" : `${portal.name} API key`}
          type="password"
          autoComplete="off"
          placeholder={savedKey === "set" ? "Saved · paste a new one to replace it" : "Paste it here"}
          hint="Stored encrypted on your server, and never shown again."
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        <Button type="submit" className="self-start" aria-disabled={status.state === "checking" || undefined}>
          {status.state === "checking" ? "Checking…" : "Check it"}
        </Button>
      </form>
      <div role="status" className="text-sm empty:hidden">
        {status.state === "connected" && <p className="text-success">It works: Dossier can search {portal.name}.</p>}
        {status.state === "failed" && <p className="rounded-card bg-warning-surface px-4 py-3 font-medium text-warning">{status.message}</p>}
      </div>
    </div>
  );
}

/** A reviewed portal from the catalog, not added yet (E23-4): ticking it adds it and switches it on. */
function CatalogRow({ entry, onAdd }: { entry: CatalogPortalView; onAdd: () => Promise<unknown> }) {
  const id = useId();
  const [adding, setAdding] = useState(false);
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={adding}
          disabled={adding}
          onChange={() => {
            setAdding(true);
            void onAdd().finally(() => setAdding(false));
          }}
          aria-describedby={`${id}-about`}
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
            {entry.name}
            <span className="rounded-full bg-track px-2 py-0.5 text-xs font-normal text-ink">Reviewed</span>
            <span className="rounded-full bg-track px-2 py-0.5 text-xs font-normal text-ink">{entry.needsKey ? "Needs a key" : "Free"}</span>
          </label>
          <p id={`${id}-about`} className="text-meta text-pretty text-muted">
            {entry.description} It reaches {entry.hosts.join(", ")}.
          </p>
        </div>
      </div>
    </Card>
  );
}
