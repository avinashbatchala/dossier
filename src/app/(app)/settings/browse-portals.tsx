"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { countryName } from "@/lib/job-search/countries";
import type { JobSearchSettingsView } from "@/lib/job-search/sources";
import type { CatalogPortalView, CatalogView } from "@/lib/portals/catalog";

import { browsePortals, installFromCatalog } from "./actions";

/** "Mostly tech", "Any kind of job": a portal's kinds of work. */
const KIND_NAMES: Record<string, string> = { tech: "Mostly tech", any: "Any kind of job" };
const ACCESS_NAMES: Record<string, string> = { "official-api": "Official API", "public-feed": "Public feed", unofficial: "Unofficial" };
const ANY = "";

const listed = (items: readonly string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : (items[0] ?? ""));
const badge = "rounded-full bg-track px-2 py-0.5 text-xs font-normal text-ink";

// The catalog Browse portals opened, for the column beside Job search
// (#522): the button in the section opens it, and the column shows it.
type CatalogState = { catalog: CatalogView | null; loading: boolean };
let state: CatalogState = { catalog: null, loading: false };
const listeners = new Set<() => void>();
/** The section's own: a portal added from the catalog shows among its cards. */
let installed: ((view: JobSearchSettingsView) => void) | null = null;

function setCatalogState(next: Partial<CatalogState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => state;
const useCatalog = () => useSyncExternalStore(subscribe, snapshot, snapshot);

const BUTTON_ID = "browse-portals";

/**
 * Browse portals (E23-4): opens the catalog of reviewed portals in the
 * column beside the section (#522), below it on narrower screens. The
 * catalog is fetched on the click only.
 */
export function BrowsePortals({ onInstalled }: { onInstalled: (view: JobSearchSettingsView) => void }) {
  const { catalog, loading } = useCatalog();
  useEffect(() => {
    installed = onInstalled;
    return () => {
      installed = null;
    };
  }, [onInstalled]);
  // Leaving Job search closes it.
  useEffect(() => () => setCatalogState({ catalog: null, loading: false }), []);

  const open = async () => {
    setCatalogState({ loading: true });
    const result = toastResult(await browsePortals({}));
    setCatalogState({ loading: false, ...(result.ok ? { catalog: result.data } : {}) });
  };

  return (
    <Button
      id={BUTTON_ID}
      variant="secondary"
      className="self-start"
      aria-expanded={catalog !== null}
      aria-disabled={loading || undefined}
      onClick={() => !loading && (catalog ? setCatalogState({ catalog: null }) : void open())}
    >
      {loading ? "Opening the catalog…" : catalog ? "Close the catalog" : "Browse portals"}
    </Button>
  );
}

/** The catalog, filtered by country and kind of work, once Browse portals opened it (#522). */
export function PortalCatalog() {
  const { catalog } = useCatalog();
  if (!catalog) return null;
  return <Catalog catalog={catalog} />;
}

/**
 * The catalog of reviewed portals (E23-4). Adding one shows the same facts
 * as Add portal first: every host it reaches and what it asks for.
 */
function Catalog({ catalog }: { catalog: CatalogView }) {
  const [country, setCountry] = useState(ANY);
  const [kind, setKind] = useState(ANY);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // Opening it takes focus there, which also brings it into view below the section on narrower screens.
  useEffect(() => heading.current?.focus(), []);
  const close = () => {
    setCatalogState({ catalog: null });
    document.getElementById(BUTTON_ID)?.focus();
  };

  const countries = [...new Set(catalog.portals.flatMap((portal) => portal.countries ?? []))].sort((a, b) => countryName(a).localeCompare(countryName(b), "en"));
  const kinds = [...new Set(catalog.portals.flatMap((portal) => portal.kinds))];
  const shown = catalog.portals.filter(
    (portal) => (country === ANY || portal.countries === null || portal.countries.includes(country)) && (kind === ANY || portal.kinds.includes(kind) || portal.kinds.includes("any")),
  );

  return (
    <Card className="@container flex w-full flex-col gap-5">
      <section aria-labelledby={headingId} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 id={headingId} ref={heading} tabIndex={-1} className="text-[15px] font-medium focus:outline-none">
            Browse portals
          </h3>
          <p className="text-meta text-pretty text-muted">
            Portals reviewed for the catalog: each has an official API or a public feed, or terms that allow it, and reaches only its own hosts.
          </p>
        </div>
        {catalog.readAt === null ? (
          <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
            The catalog can&apos;t be reached right now. Try again later; Add portal takes a config from a file or a link meanwhile.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
              <Select label="Country" value={country} onChange={(event) => setCountry(event.target.value)}>
                <option value={ANY}>Any country</option>
                {countries.map((code) => (
                  <option key={code} value={code}>
                    {countryName(code)}
                  </option>
                ))}
              </Select>
              <Select label="Kind of work" value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value={ANY}>Any kind of work</option>
                {kinds.map((value) => (
                  <option key={value} value={value}>
                    {KIND_NAMES[value] ?? value}
                  </option>
                ))}
              </Select>
            </div>
            {shown.length === 0 ? (
              <p className="text-meta text-muted">No portal in the catalog fits these.</p>
            ) : (
              <ul className="flex flex-col gap-3" aria-label="Portals in the catalog">
                {shown.map((portal) => (
                  <li key={portal.id}>
                    <CatalogCard
                      portal={portal}
                      onInstalled={(view, next) => {
                        installed?.(view);
                        setCatalogState({ catalog: next });
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <Button variant="secondary" size="sm" className="self-start" onClick={close}>
          Close
        </Button>
      </section>
    </Card>
  );
}

/** One catalog entry: what it is, and Add, which shows what it reaches first. */
function CatalogCard({ portal, onInstalled }: { portal: CatalogPortalView; onInstalled: (view: JobSearchSettingsView, catalog: CatalogView) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [adding, setAdding] = useState(false);

  const add = async () => {
    setAdding(true);
    const result = toastResult(await installFromCatalog({ portal: portal.id }));
    setAdding(false);
    if (result.ok) onInstalled(result.data.view, result.data.catalog);
  };

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line-card p-4">
      <div className="flex flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
          {portal.name}
          <span className={badge}>{portal.builtIn ? "Built in" : "Reviewed"}</span>
          <span className={badge}>{ACCESS_NAMES[portal.access] ?? portal.access}</span>
          <span className={badge}>{portal.needsKey ? "Needs a key" : "Free"}</span>
        </p>
        {portal.description && <p className="text-meta text-pretty text-muted">{portal.description}</p>}
        <p className="text-xs text-muted">
          {portal.countries === null ? "Every country" : listed(portal.countries.map(countryName))} · {listed(portal.kinds.map((kind) => KIND_NAMES[kind] ?? kind))}
          {portal.termsUrl && (
            <>
              {" · "}
              <a href={portal.termsUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">
                Its terms <span className="sr-only">(opens in a new tab)</span>
              </a>
            </>
          )}
        </p>
      </div>
      {portal.state === "built-in" ? (
        <p className="text-meta text-muted">Comes with Dossier: switch it on among your portals.</p>
      ) : portal.state === "added" ? (
        <p className="text-meta text-muted">Added{portal.installedVersion && portal.installedVersion !== portal.version ? `, version ${portal.installedVersion}: its update shows on its card` : ""}.</p>
      ) : confirming ? (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <dl className="grid gap-x-6 gap-y-2 text-sm @md:grid-cols-[150px_1fr]">
            <dt className="font-medium">It reaches</dt>
            <dd className="font-mono text-[13px] text-muted">
              {portal.hosts.map((host) => (
                <span key={host} className="block">
                  {host}
                </span>
              ))}
            </dd>
            <dt className="font-medium">It asks for</dt>
            <dd className="text-muted">{portal.asks.length > 0 ? listed(portal.asks) : "Nothing: no key or account"}</dd>
          </dl>
          <p className="text-meta text-muted">Your searches, and any key you give it, go to these hosts only.</p>
          <div className="flex flex-wrap gap-2.5">
            <Button aria-disabled={adding || undefined} onClick={() => !adding && void add()}>
              {adding ? "Adding…" : `Add ${portal.name}`}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => setConfirming(true)}>
          Add <span className="sr-only">{portal.name}</span>
        </Button>
      )}
    </div>
  );
}
