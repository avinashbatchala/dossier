"use client";

import { useId, useState } from "react";

import { ArbeitsagenturNote } from "@/components/arbeitsagentur-note";
import { KeyField } from "@/components/key-field";
import { useTrackSave } from "@/components/save-tracker";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import type { JobSource, JSearchHost } from "@/lib/job-search/search";
import { FREEHIRE_URL, JSEARCH_KEY_URLS, type JobSearchSettingsView, type PortalFieldView, type PortalView } from "@/lib/job-search/sources";
import { cn } from "@/lib/cn";
import { ARCHIVE_DAYS, DEFAULT_ARCHIVE_DAYS } from "@/lib/settings";

import { keepWithdrawnPortal, removePortal, savePortalField, savePortalKey, setPortalOn, testPortal, updatePortal, updateSettings } from "./actions";
import { AddPortal } from "./add-portal";
import { BrowsePortals } from "./browse-portals";
import { SettingsSectionIntro } from "./settings-screen";

type Connection =
  | { status: "untested" }
  | { status: "testing" }
  | { status: "connected"; seconds: number }
  | { status: "failed"; message: string };

type Apply = (result: { ok: true; data: JobSearchSettingsView } | { ok: false; error: string }) => boolean;

/**
 * Settings → Job search (E14-4, E22-3): the portals Find jobs searches. Any
 * number can be on, and each keeps its own fields. A field saves when you
 * leave it, and a key is never shown again. The Bundesagentur für Arbeit goes
 * on only once its note is accepted, and isn't offered when the server turns
 * it off (#223). Below them, when untouched postings move to the Archive
 * (E22-7).
 */
/** A portal the catalog withdrew (E23-5): paused, saying why, until the user keeps it or removes it. */
function Withdrawn({ portal, apply, track }: { portal: PortalView; apply: Apply; track: ReturnType<typeof useTrackSave> }) {
  return (
    <div role="note" className="flex flex-col gap-2 rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
      <p>
        <span className="font-medium">Withdrawn from the catalog, so it&apos;s paused:</span> no search goes to it. {portal.withdrawal!.reason}
      </p>
      <p>Remove it, switch it off, or keep searching it if you trust it anyway.</p>
      <Button variant="secondary" size="sm" className="self-start" onClick={() => void track(keepWithdrawnPortal({ portal: portal.id })).then((result) => apply(toastResult(result)))}>
        Keep searching {portal.name}
      </Button>
    </div>
  );
}

/** A newer version in the catalog (E23-5): what changed, and the new hosts to approve before it's installed. */
function UpdateAvailable({ portal, update, apply, track }: { portal: PortalView; update: NonNullable<PortalView["update"]>; apply: Apply; track: ReturnType<typeof useTrackSave> }) {
  const [approved, setApproved] = useState<string[]>([]);
  const [updating, setUpdating] = useState(false);
  const ready = update.newHosts.every((host) => approved.includes(host));
  const install = async () => {
    setUpdating(true);
    apply(toastResult(await track(updatePortal({ portal: portal.id, approvedHosts: approved }))));
    setUpdating(false);
  };
  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-line-card px-4 py-3 text-meta">
      <p className="font-medium">
        Update available: version {update.from} → {update.to}
      </p>
      <ul className="list-disc pl-5 text-muted">
        {update.changes.map((change) => (
          <li key={change}>{change}</li>
        ))}
      </ul>
      {update.newHosts.map((host) => (
        <Checkbox
          key={host}
          label={
            <span>
              Let it reach <span className="font-mono">{host}</span>, a host it doesn&apos;t reach now
            </span>
          }
          checked={approved.includes(host)}
          onChange={(event) => setApproved((current) => (event.target.checked ? [...current, host] : current.filter((entry) => entry !== host)))}
        />
      ))}
      <Button size="sm" className="self-start" aria-disabled={!ready || updating || undefined} onClick={() => ready && !updating && void install()}>
        {updating ? "Updating…" : `Update ${portal.name}`}
      </Button>
    </div>
  );
}

/** A portal the user added (E23-3): its terms, and Remove, which asks first. */
function InstalledActions({ portal, apply, track }: { portal: PortalView; apply: Apply; track: ReturnType<typeof useTrackSave> }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="-mt-2 flex flex-wrap items-center gap-3 text-meta">
      {portal.installed?.termsUrl && (
        <a href={portal.installed.termsUrl} target="_blank" rel="noopener noreferrer" className="text-muted underline underline-offset-2 hover:text-ink">
          Its terms <span className="sr-only">(opens in a new tab)</span>
        </a>
      )}
      <button type="button" onClick={() => setConfirming(true)} className="text-muted underline underline-offset-2 hover:text-ink">
        Remove portal <span className="sr-only">{portal.name}</span>
      </button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Remove ${portal.name}?`}
        description="It's no longer searched, and its key is deleted. What it found stays in Positions. You can add it again later."
        confirmLabel="Remove portal"
        onConfirm={() => void track(removePortal({ portal: portal.id })).then((result) => apply(toastResult(result)))}
      />
    </div>
  );
}

export function JobSearchSection({ initial, archiveDays = DEFAULT_ARCHIVE_DAYS }: { initial: JobSearchSettingsView; archiveDays?: number }) {
  const track = useTrackSave();
  const [view, setView] = useState(initial);
  const [days, setDays] = useState(archiveDays);

  const changeDays = (next: number) => {
    const before = days;
    setDays(next);
    void track(updateSettings({ archiveAfterDays: next })).then((result) => {
      if (!result.ok) {
        setDays(before);
        toast(result.error);
      }
    });
  };

  const apply: Apply = (result) => {
    if (result.ok) setView(result.data);
    return result.ok;
  };

  return (
    <>
      <SettingsSectionIntro title="Job search">
        Where Find jobs looks for postings. Switch on as many portals as you like: a search asks all of them, and each keeps its own key.
      </SettingsSectionIntro>
      <div className="flex flex-col gap-3">
        {view.portals.map((portal) => (
          <PortalCard key={portal.id} portal={portal} freehireHost={view.freehire.host} apply={apply} track={track} />
        ))}
        <div className="flex flex-wrap items-start gap-3">
          <BrowsePortals onInstalled={(next) => setView(next)} />
          <AddPortal onInstalled={(next) => setView(next)} />
        </div>
        <Card className="flex flex-col gap-3">
          <Select
            label="Move untouched postings to the archive after"
            hint="A posting you don't save, apply for or dismiss moves to Positions → Archive this long after a search last found it. Nothing is removed unless you remove it."
            value={days}
            onChange={(event) => changeDays(Number(event.target.value))}
          >
            {ARCHIVE_DAYS.map((option) => (
              <option key={option} value={option}>
                {option} days
              </option>
            ))}
          </Select>
        </Card>
      </div>
    </>
  );
}

function PortalCard({ portal, freehireHost, apply, track }: { portal: PortalView; freehireHost: string; apply: Apply; track: ReturnType<typeof useTrackSave> }) {
  const [connection, setConnection] = useState<Connection>({ status: "untested" });
  // Switching on a portal with a note shows the note first; it goes on once accepted.
  const [asking, setAsking] = useState(false);
  const changed = () => setConnection({ status: "untested" });
  const open = portal.on || asking;

  const switchTo = async (on: boolean) => {
    changed();
    if (on && portal.consent && !portal.acceptedAt) {
      setAsking(true);
      return;
    }
    setAsking(false);
    apply(toastResult(await track(setPortalOn({ portal: portal.id, on }))));
  };

  const accept = async () => {
    const ok = apply(toastResult(await track(setPortalOn({ portal: portal.id, on: true, accepted: true }))));
    if (ok) setAsking(false);
    return ok;
  };

  const saveField = async (field: string, value: string) => {
    changed();
    apply(toastResult(await track(savePortalField({ portal: portal.id, field, value }))));
  };

  const saveKey = async (field: string, change: { action: "set"; value: string } | { action: "clear" }) => {
    changed();
    return apply(toastResult(await track(savePortalKey({ portal: portal.id, field, change }))));
  };

  const test = async () => {
    if (connection.status === "testing") return;
    setConnection({ status: "testing" });
    const result = await testPortal({ portal: portal.id });
    if (!result.ok) setConnection({ status: "failed", message: result.error });
    else if (result.data.connected) setConnection({ status: "connected", seconds: result.data.seconds });
    else setConnection({ status: "failed", message: result.data.message });
  };

  return (
    <Card className="flex flex-col gap-5">
      <Toggle
        label={<span className="text-[15px] font-medium">{portal.name}</span>}
        description={
          <span className="flex flex-col gap-1">
            <span>{portal.description}</span>
            <span className="text-xs">{portal.tag}</span>
            {portal.installed && (
              <span className="text-xs">
                {portal.installed.origin === "file" ? "Added from a file" : portal.installed.origin === "link" ? "Added from a link" : "Added from the catalog"} ·{" "}
                {portal.installed.reviewed ? "Reviewed" : "Not reviewed"}
              </span>
            )}
          </span>
        }
        checked={portal.on || asking}
        onCheckedChange={(on) => void switchTo(on)}
      />
      {portal.installed && <InstalledActions portal={portal} apply={apply} track={track} />}
      {portal.withdrawal?.paused && <Withdrawn portal={portal} apply={apply} track={track} />}
      {portal.update && <UpdateAvailable portal={portal} update={portal.update} apply={apply} track={track} />}

      {open && (
        <>
          {portal.consent && <ArbeitsagenturNote accepted={Boolean(portal.acceptedAt)} onAccept={accept} />}
          <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
            Your searches (keywords, place and filters) go to {portal.name}. Nothing from your profile does.
          </p>
          {portal.fields.length > 0 && (
            <div className="grid grid-cols-1 gap-x-[18px] gap-y-5 sm:grid-cols-2">
              {portal.fields.map((field) => (
                <PortalField key={field.name} portal={portal} field={field} onSave={saveField} onSaveKey={saveKey} />
              ))}
            </div>
          )}
          {portal.id === "FREEHIRE" && (
            <p className="text-sm text-muted">
              {freehireHost === new URL(FREEHIRE_URL).host
                ? `No key needed. Dossier searches FreeHire's public catalogue at ${freehireHost}.`
                : `No key needed. Dossier searches your own FreeHire at ${freehireHost}.`}
            </p>
          )}
          {portal.id === "ARBEITSAGENTUR" && <p className="text-sm text-muted">No key needed. The job agent doesn&apos;t search this portal.</p>}
          {portal.on && (
            <div className="flex flex-wrap items-center gap-3.5 pt-1">
              <Button variant="secondary" onClick={() => void test()} disabled={connection.status === "testing"}>
                {connection.status === "testing" ? "Testing…" : "Test connection "}
                {connection.status !== "testing" && <span className="sr-only">to {portal.name}</span>}
              </Button>
              <ConnectionStatus connection={connection} portal={portal} />
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function PortalField({
  portal,
  field,
  onSave,
  onSaveKey,
}: {
  portal: PortalView;
  field: PortalFieldView;
  onSave: (field: string, value: string) => Promise<void>;
  onSaveKey: (field: string, change: { action: "set"; value: string } | { action: "clear" }) => Promise<boolean>;
}) {
  const labelId = useId();
  const [text, setText] = useState(field.type === "text" ? field.value : "");
  if (field.type === "secret") {
    // JSearch's key comes from the host chosen beside it.
    const host = portal.fields.find((entry) => entry.type === "choice" && entry.name === "host");
    const href = portal.id === "JSEARCH" && host?.type === "choice" ? JSEARCH_KEY_URLS[host.value as JSearchHost] : portal.keyUrl;
    return (
      <KeyField
        label={field.label}
        keyState={field.keyState}
        envName={field.envName ?? ""}
        getKey={{ href: href ?? "", text: keyLinkText(portal, host?.type === "choice" ? host.value : null) }}
        onSave={(change) => onSaveKey(field.name, change)}
      />
    );
  }
  if (field.type === "list") return <ListField key={field.value} field={field} onSave={onSave} />;
  if (field.type === "choice") {
    return (
      <div className="flex flex-col gap-[7px] sm:col-span-2">
        <span id={labelId} className="text-label text-muted">
          {field.label}
        </span>
        <SegmentedControl<string> aria-labelledby={labelId} size="sm" options={field.options} value={field.value} onValueChange={(value) => void onSave(field.name, value)} />
      </div>
    );
  }
  return (
    <Input
      label={field.label}
      value={text}
      spellCheck={false}
      autoComplete="off"
      inputClassName="font-mono text-[13.5px]"
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        if (text.trim() !== field.value) void onSave(field.name, text);
      }}
    />
  );
}

/** A list field (E23, #238): one entry a line, saved when it loses focus; what's saved comes back tidied, one a line. */
function ListField({ field, onSave }: { field: Extract<PortalFieldView, { type: "list" }>; onSave: (field: string, value: string) => Promise<void> }) {
  const [text, setText] = useState(field.value);
  return (
    <Textarea
      label={field.label}
      hint={`${field.help ? `${field.help} ` : ""}One a line, up to ${field.max}.`}
      value={text}
      rows={Math.min(8, Math.max(3, text.split("\n").length + 1))}
      spellCheck={false}
      autoComplete="off"
      className="sm:col-span-2"
      textareaClassName="font-mono text-[13.5px]"
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        if (text.trim() !== field.value) void onSave(field.name, text);
      }}
    />
  );
}

/** Where a portal's "get a key" link goes, in words. */
function keyLinkText(portal: PortalView, host: string | null): string {
  if (portal.id === "JSEARCH") return host === "rapidapi" ? "JSearch on RapidAPI" : "OpenWeb Ninja";
  if (portal.id === "ADZUNA") return "Adzuna's developer site";
  return `${portal.name}'s site`;
}

function ConnectionStatus({ connection, portal }: { connection: Connection; portal: { id: JobSource; name: string; quotaPeriod: string | null } }) {
  const [dot, text, message] =
    connection.status === "connected"
      ? ["bg-success", "text-success", `Connected · ${portal.name} answered in ${connection.seconds.toLocaleString("en-US")} s`]
      : connection.status === "failed"
        ? ["bg-error", "text-error", connection.message]
        : connection.status === "testing"
          ? ["bg-status-offer", "text-muted", "Sending a small search…"]
          : ["bg-faint", "text-muted", portal.id === "JSEARCH" ? "Not tested since your last change · a test uses one search from your plan" : "Not tested since your last change"];
  return (
    <p role="status" className={cn("flex items-center gap-2 text-control", text)}>
      <span aria-hidden className={cn("size-2 flex-none rounded-full", dot)} />
      {message}
    </p>
  );
}
