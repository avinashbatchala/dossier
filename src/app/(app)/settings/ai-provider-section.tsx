"use client";

import { RadioGroup } from "radix-ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { AiProvider } from "@/generated/prisma/enums";
import { API_KEY_UNREADABLE, PROVIDER_OPTIONS, providerOption, type AiSettingsView } from "@/lib/ai/provider-options";
import { cn } from "@/lib/cn";
import { useAutosave } from "@/hooks/use-autosave";

import { listAiModels, saveAiProvider, saveApiKey, testAiConnection } from "./actions";
import { SettingsSectionIntro } from "./settings-screen";

type Connection =
  | { status: "untested" }
  | { status: "testing" }
  | { status: "connected"; model: string; seconds: number }
  | { status: "failed"; message: string };

type ModelList = { loading: true } | { loading: false; models: string[]; problem: string | null };

const toModelList = (result: Awaited<ReturnType<typeof listAiModels>>): ModelList =>
  result.ok ? { loading: false, ...result.data } : { loading: false, models: [], problem: result.error };

const OTHER_MODEL = "__other";
const looksLikeUrl = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

/** What a hosted model is sent (profileForPrompt and the tasks in src/lib/ai/tasks; PRIVACY.md). */
const SENT_TO_HOSTED =
  "your profile without contact details, the postings you add and what you tell it about each one, and, when you refine, the drafts and your chat messages. Importing a resume sends its whole text, contact details included. With Gmail connected, it also gets each reply it reads or answers, with earlier mail in the thread. The notes you keep on an application are never sent.";

/**
 * Settings → AI provider (E6-3, SET-1, SET-2). Each field saves on its own:
 * picking a card or a model right away, typing once you pause. The key is
 * saved when you leave its field and never shown again.
 */
export function AiProviderSection({ initial }: { initial: AiSettingsView }) {
  const track = useTrackSave();
  const [provider, setProvider] = useState(initial.provider);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [model, setModel] = useState(initial.model);
  const [keyState, setKeyState] = useState(initial.keyState);
  const [keyInput, setKeyInput] = useState("");
  const [otherModel, setOtherModel] = useState(false);
  const [urlLeft, setUrlLeft] = useState(false);
  const [connection, setConnection] = useState<Connection>({ status: "untested" });
  const [modelList, setModelList] = useState<ModelList>({ loading: true });
  const option = providerOption(provider);

  const reloadModels = () => {
    setModelList({ loading: true });
    void listAiModels({}).then((result) => setModelList(toModelList(result)));
  };

  // The list for what's saved when the page opens.
  useEffect(() => {
    let current = true;
    void listAiModels({}).then((result) => {
      if (current) setModelList(toModelList(result));
    });
    return () => {
      current = false;
    };
  }, []);

  // SET-2: any change to the provider fields means the last test no longer counts.
  const changed = () => setConnection({ status: "untested" });

  const fields = useMemo(() => ({ provider, baseUrl, model }), [provider, baseUrl, model]);
  const savedServer = useRef(`${initial.provider} ${initial.baseUrl}`);
  const { flush } = useAutosave(fields, async (value) => {
    const result = await track(saveAiProvider(value));
    if (result.ok) {
      setKeyState(result.data.keyState);
      // A different server may offer different models.
      const server = `${value.provider} ${value.baseUrl}`;
      if (server !== savedServer.current) {
        savedServer.current = server;
        reloadModels();
      }
    }
    return result;
  });

  // Cards and the model select save at once, not after a pause.
  const [saveNow, setSaveNow] = useState(0);
  useEffect(() => {
    if (saveNow > 0) flush();
  }, [saveNow, flush]);

  const chooseProvider = (next: AiProvider) => {
    const nextOption = providerOption(next);
    setProvider(next);
    setBaseUrl(nextOption.defaultUrl);
    setModel(nextOption.defaultModel);
    setOtherModel(false);
    setUrlLeft(false);
    setKeyInput("");
    changed();
    setSaveNow((count) => count + 1);
  };

  const saveKey = async (change: { action: "set"; value: string } | { action: "clear" }) => {
    const result = toastResult(await track(saveApiKey({ provider, change })));
    if (!result.ok) return;
    setKeyState(result.data.keyState);
    setKeyInput("");
    changed();
    reloadModels();
  };

  const test = async () => {
    if (connection.status === "testing") return;
    if (keyInput.trim()) await saveKey({ action: "set", value: keyInput });
    // Actions run one after another, so pending saves land before the test.
    flush();
    setConnection({ status: "testing" });
    const result = await testAiConnection({});
    if (!result.ok) setConnection({ status: "failed", message: result.error });
    else if (result.data.connected) setConnection({ status: "connected", model: result.data.model, seconds: result.data.seconds });
    else setConnection({ status: "failed", message: result.data.message });
  };

  const models = [...new Set([...(modelList.loading ? [] : modelList.models), model].filter(Boolean))];

  return (
    <>
      <SettingsSectionIntro title="AI provider">
        This is what reads job postings and writes your drafts. A local model keeps everything on your machine.
      </SettingsSectionIntro>

      <RadioGroup.Root
        aria-label="Provider"
        value={provider}
        onValueChange={(value) => chooseProvider(value as AiProvider)}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {PROVIDER_OPTIONS.map((entry) => (
          <RadioGroup.Item
            key={entry.value}
            value={entry.value}
            aria-label={entry.name}
            aria-describedby={`provider-${entry.value}`}
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
            <span id={`provider-${entry.value}`} className="flex flex-col gap-1.5">
              <span className="text-meta text-muted">{entry.description}</span>
              <span className="text-xs text-muted">{entry.tag}</span>
            </span>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>

      {!option.local && (
        <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
          {option.vendor
            ? `${option.vendor} receives what each task needs: ${SENT_TO_HOSTED} How long it's kept and where it's processed depend on your account with ${option.vendor}.`
            : `This server receives what each task needs: ${SENT_TO_HOSTED} If it isn't on your own network, all this leaves your server, and how long it's kept is up to whoever runs it.`}
        </p>
      )}

      <Card className="grid grid-cols-1 gap-x-[18px] gap-y-5 sm:grid-cols-2">
        <Input
          className="sm:col-span-2"
          label="Server address"
          inputClassName="font-mono text-[13.5px]"
          value={baseUrl}
          placeholder={option.urlPlaceholder}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setBaseUrl(event.target.value);
            changed();
          }}
          onBlur={() => {
            setUrlLeft(true);
            flush();
          }}
          hint={
            urlLeft && baseUrl.trim() && !looksLikeUrl(baseUrl)
              ? "Start the address with http:// or https://."
              : option.urlHint
          }
        />

        <div className="flex flex-col gap-2.5">
          <Select
            label="Model"
            value={otherModel ? OTHER_MODEL : model}
            onChange={(event) => {
              if (event.target.value === OTHER_MODEL) {
                setOtherModel(true);
                return;
              }
              setOtherModel(false);
              setModel(event.target.value);
              changed();
              setSaveNow((count) => count + 1);
            }}
            hint={!modelList.loading && modelList.problem ? `Couldn't list the models: ${modelList.problem}` : undefined}
          >
            {!model && !otherModel && <option value="">{modelList.loading ? "Loading models…" : "Choose a model"}</option>}
            {models.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            <option value={OTHER_MODEL}>Other model…</option>
          </Select>
          {otherModel && (
            <Input
              label="Model name"
              value={model}
              placeholder="e.g. llama3.1:8b"
              spellCheck={false}
              autoFocus
              onChange={(event) => {
                setModel(event.target.value);
                changed();
              }}
              onBlur={flush}
            />
          )}
        </div>

        {option.apiKey ? (
          <div className="flex flex-col gap-2.5">
            <Input
              label={option.apiKey.label}
              hint={keyState === "unreadable" ? undefined : option.apiKey.hint}
              type="password"
              autoComplete="off"
              value={keyInput}
              placeholder={
                keyState === "set"
                  ? "Saved · type a new key to replace it"
                  : keyState === "env"
                    ? "Using DOSSIER_AI_KEY · type one to save it here"
                    : "Stored encrypted on your server"
              }
              error={keyState === "unreadable" ? API_KEY_UNREADABLE : undefined}
              onChange={(event) => setKeyInput(event.target.value)}
              onBlur={() => {
                if (keyInput.trim()) void saveKey({ action: "set", value: keyInput });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && keyInput.trim()) {
                  event.preventDefault();
                  void saveKey({ action: "set", value: keyInput });
                }
              }}
            />
            {(keyState === "set" || keyState === "unreadable") && (
              <Button variant="text" size="sm" className="self-start" onClick={() => void saveKey({ action: "clear" })}>
                Remove saved key
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-[7px]">
            <span className="text-label text-muted">API key</span>
            <p className="py-[11px] text-sm text-muted">Not needed for a local model</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3.5 pt-1 sm:col-span-2">
          <Button variant="secondary" onClick={() => void test()} disabled={connection.status === "testing"}>
            {connection.status === "testing" ? "Testing…" : "Test connection"}
          </Button>
          <ConnectionStatus connection={connection} />
        </div>
      </Card>
    </>
  );
}

function ConnectionStatus({ connection }: { connection: Connection }) {
  const [dot, text, message] =
    connection.status === "connected"
      ? ["bg-success", "text-success", `Connected · ${connection.model} answered in ${connection.seconds.toLocaleString("en-US")} s`]
      : connection.status === "failed"
        ? ["bg-error", "text-error", connection.message]
        : connection.status === "testing"
          ? ["bg-status-offer", "text-muted", "Sending a short test prompt…"]
          : ["bg-faint", "text-muted", "Not tested since your last change"];
  return (
    <p role="status" className={cn("flex items-start gap-2 text-control", text)}>
      {/* One line high, so the dot stays by the first line when the message wraps. */}
      <span aria-hidden className="flex h-lh flex-none items-center">
        <span className={cn("size-2 rounded-full", dot)} />
      </span>
      {message}
    </p>
  );
}
