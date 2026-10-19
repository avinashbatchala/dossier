"use client";

import { RadioGroup } from "radix-ui";
import { useId, useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { JOB_SOURCES, type JobSource, type JSearchHost } from "@/lib/job-search/search";
import { JOB_KEY_UNREADABLE, JSEARCH_KEY_URLS, SOURCE_INFO, type JobKeyState, type JobSearchSettingsView } from "@/lib/job-search/sources";
import { cn } from "@/lib/cn";

import { saveJobSearchDetails, saveJobSource, saveJobSourceKey, testJobSource } from "./actions";
import { SettingsSectionIntro } from "./settings-screen";

type Choice = JobSource | "OFF";

const CHOICES: readonly { value: Choice; name: string; description: string; tag: string }[] = [
  ...JOB_SOURCES.map((source) => ({ value: source, ...SOURCE_INFO[source] })),
  { value: "OFF", name: "Off", description: "Find jobs stays off, and no search leaves your server.", tag: "Nothing is sent anywhere" },
];

type Connection =
  | { status: "untested" }
  | { status: "testing" }
  | { status: "connected"; seconds: number }
  | { status: "failed"; message: string };

/**
 * Settings → Job search (E14-4): which source Find jobs searches, and its
 * key. Each field saves on its own; a key is saved when you leave its field
 * and never shown again.
 */
export function JobSearchSection({ initial }: { initial: JobSearchSettingsView }) {
  const track = useTrackSave();
  const [view, setView] = useState(initial);
  const [appId, setAppId] = useState(initial.adzuna.appId);
  const [connection, setConnection] = useState<Connection>({ status: "untested" });
  const source = view.source;

  // Any change means the last test no longer counts.
  const changed = () => setConnection({ status: "untested" });

  const apply = (result: Awaited<ReturnType<typeof saveJobSource>>) => {
    if (result.ok) setView(result.data);
    return result.ok;
  };

  const choose = async (next: Choice) => {
    setView((current) => ({ ...current, source: next }));
    changed();
    apply(toastResult(await track(saveJobSource({ source: next }))));
  };

  const chooseHost = async (host: JSearchHost) => {
    setView((current) => ({ ...current, jsearch: { ...current.jsearch, host } }));
    changed();
    apply(toastResult(await track(saveJobSearchDetails({ jsearchHost: host }))));
  };

  const saveAppId = async () => {
    if (appId.trim() === view.adzuna.appId) return;
    changed();
    apply(toastResult(await track(saveJobSearchDetails({ adzunaAppId: appId }))));
  };

  const saveKey = async (keySource: "JSEARCH" | "ADZUNA", change: { action: "set"; value: string } | { action: "clear" }) => {
    changed();
    return apply(toastResult(await track(saveJobSourceKey({ source: keySource, change }))));
  };

  const test = async () => {
    if (connection.status === "testing") return;
    setConnection({ status: "testing" });
    const result = await testJobSource({});
    if (!result.ok) setConnection({ status: "failed", message: result.error });
    else if (result.data.connected) setConnection({ status: "connected", seconds: result.data.seconds });
    else setConnection({ status: "failed", message: result.data.message });
  };

  return (
    <>
      <SettingsSectionIntro title="Job search">
        Where Find jobs looks for postings. Pick one source; you can switch any time, and each keeps its own key.
      </SettingsSectionIntro>

      <RadioGroup.Root
        aria-label="Job source"
        value={source}
        onValueChange={(value) => void choose(value as Choice)}
        className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3"
      >
        {CHOICES.map((entry) => (
          <RadioGroup.Item
            key={entry.value}
            value={entry.value}
            aria-label={entry.name}
            aria-describedby={`job-source-${entry.value}`}
            className="group flex flex-col gap-1.5 rounded-card border border-line-card bg-card p-[18px] text-left hover:border-line-strong data-[state=checked]:border-primary data-[state=checked]:shadow-[0_0_0_1px_var(--color-primary)]"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-[15px] font-medium">{entry.name}</span>
              <span
                aria-hidden
                className="grid size-4 place-items-center rounded-full border-[1.5px] border-line-strong group-data-[state=checked]:border-primary"
              >
                <RadioGroup.Indicator className="size-2 rounded-full bg-primary" />
              </span>
            </span>
            <span id={`job-source-${entry.value}`} className="flex flex-col gap-1.5">
              <span className="text-meta text-muted">{entry.description}</span>
              <span className="text-xs text-muted">{entry.tag}</span>
            </span>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>

      {source !== "OFF" && (
        <>
          <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
            Your searches (keywords, place and filters) go to {SOURCE_INFO[source].name}. Nothing from your profile does.
          </p>

          <Card className="flex flex-col gap-5">
            {source === "JSEARCH" && (
              <>
                <HostChoice host={view.jsearch.host} onChange={(host) => void chooseHost(host)} />
                <KeyField
                  label="API key"
                  keyState={view.jsearch.keyState}
                  envName="DOSSIER_JSEARCH_KEY"
                  getKey={{ href: JSEARCH_KEY_URLS[view.jsearch.host], text: view.jsearch.host === "rapidapi" ? "JSearch on RapidAPI" : "OpenWeb Ninja" }}
                  onSave={(change) => saveKey("JSEARCH", change)}
                />
              </>
            )}
            {source === "ADZUNA" && (
              <div className="grid grid-cols-1 gap-x-[18px] gap-y-5 sm:grid-cols-2">
                <Input
                  label="App ID"
                  value={appId}
                  spellCheck={false}
                  autoComplete="off"
                  inputClassName="font-mono text-[13.5px]"
                  onChange={(event) => setAppId(event.target.value)}
                  onBlur={() => void saveAppId()}
                />
                <KeyField
                  label="App key"
                  keyState={view.adzuna.keyState}
                  envName="DOSSIER_ADZUNA_KEY"
                  getKey={{ href: SOURCE_INFO.ADZUNA.keyUrl!, text: "Adzuna's developer site" }}
                  onSave={(change) => saveKey("ADZUNA", change)}
                />
              </div>
            )}
            {source === "ARBEITSAGENTUR" && (
              <p className="text-sm text-muted">
                No key needed. Dossier uses the public access that the Arbeitsagentur&apos;s own job search uses. It isn&apos;t an official
                API, so it can change without notice.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3.5 pt-1">
              <Button variant="secondary" onClick={() => void test()} disabled={connection.status === "testing"}>
                {connection.status === "testing" ? "Testing…" : "Test connection"}
              </Button>
              <ConnectionStatus connection={connection} source={source} />
            </div>
          </Card>
        </>
      )}
    </>
  );
}

function HostChoice({ host, onChange }: { host: JSearchHost; onChange: (host: JSearchHost) => void }) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-[7px]">
      <span id={labelId} className="text-label text-muted">
        Key from
      </span>
      <SegmentedControl<JSearchHost>
        aria-labelledby={labelId}
        size="sm"
        options={[
          { value: "openwebninja", label: "OpenWeb Ninja" },
          { value: "rapidapi", label: "RapidAPI" },
        ]}
        value={host}
        onValueChange={onChange}
      />
    </div>
  );
}

/** A write-only key: saved when you leave the field or press Enter, then only "Saved" shows. */
function KeyField({
  label,
  keyState,
  envName,
  getKey,
  onSave,
}: {
  label: string;
  keyState: JobKeyState;
  envName: string;
  getKey: { href: string; text: string };
  onSave: (change: { action: "set"; value: string } | { action: "clear" }) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const save = async () => {
    if (!value.trim()) return;
    if (await onSave({ action: "set", value })) setValue("");
  };
  return (
    <div className="flex flex-col gap-2.5">
      <Input
        label={label}
        type="password"
        autoComplete="off"
        value={value}
        placeholder={
          keyState === "set" ? "Saved · type a new key to replace it" : keyState === "env" ? `Using ${envName} · type one to save it here` : "Stored encrypted on your server"
        }
        error={keyState === "unreadable" ? JOB_KEY_UNREADABLE : undefined}
        hint={
          keyState === "none" ? (
            <>
              Get one from{" "}
              <a href={getKey.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">
                {getKey.text}
              </a>
              .
            </>
          ) : undefined
        }
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter" && value.trim()) {
            event.preventDefault();
            void save();
          }
        }}
      />
      {(keyState === "set" || keyState === "unreadable") && (
        <Button variant="text" size="sm" className="self-start" onClick={() => void onSave({ action: "clear" })}>
          Remove saved key
        </Button>
      )}
    </div>
  );
}

function ConnectionStatus({ connection, source }: { connection: Connection; source: JobSource }) {
  const [dot, text, message] =
    connection.status === "connected"
      ? ["bg-success", "text-success", `Connected · ${SOURCE_INFO[source].name} answered in ${connection.seconds.toLocaleString("en-US")} s`]
      : connection.status === "failed"
        ? ["bg-error", "text-error", connection.message]
        : connection.status === "testing"
          ? ["bg-status-offer", "text-muted", "Sending a small search…"]
          : ["bg-faint", "text-muted", source === "JSEARCH" ? "Not tested since your last change · a test uses one search from your plan" : "Not tested since your last change"];
  return (
    <p role="status" className={cn("flex items-center gap-2 text-control", text)}>
      <span aria-hidden className={cn("size-2 flex-none rounded-full", dot)} />
      {message}
    </p>
  );
}
