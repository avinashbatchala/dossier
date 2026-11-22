"use client";

import { RadioGroup } from "radix-ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { AiProvider } from "@/generated/prisma/enums";
import { AI_TIMEOUT_LIMITS, API_KEY_UNREADABLE, defaultTimeoutSeconds, PROVIDER_OPTIONS, providerOption, type AiSettingsView } from "@/lib/ai/provider-options";
import { cn } from "@/lib/cn";
import { useAutosave } from "@/hooks/use-autosave";

import { formatShortDate } from "@/lib/dates";

import { listAiModels, saveAiProvider, saveAiTimeout, saveApiKey, testAiConnection } from "./actions";
import { publishAiChoice, whereItRuns } from "./ai-data-flows";
import { SettingsSectionIntro } from "./settings-screen";

type Connection =
  | { status: "untested" }
  | { status: "testing" }
  | { status: "connected"; model: string; seconds: number; at: string }
  | { status: "failed"; message: string; at: string };

type ModelList = { loading: true } | { loading: false; models: string[]; problem: string | null };

const toModelList = (result: Awaited<ReturnType<typeof listAiModels>>): ModelList =>
  result.ok ? { loading: false, ...result.data } : { loading: false, models: [], problem: result.error };

const OTHER_MODEL = "__other";
const looksLikeUrl = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

/** Under each provider's name (E34-4, ST3): where it runs. */
const WHERE_WORDS = { computer: "On your hardware", network: "On your hardware", hosted: "Hosted" } as const;

function whereLine(provider: AiProvider, baseUrl: string, chosen: boolean): string {
  if (provider === "MISTRAL") return "Hosted, in the EU";
  // An OpenAI-compatible server is either, by its address; until it's chosen, it could be.
  if (provider === "OPENAI" && !chosen) return "Hosted or yours, by its address";
  return WHERE_WORDS[whereItRuns(provider, baseUrl)];
}

/** The saved test's result, as the section starts (E34-1). */
const savedConnection = (initial: AiSettingsView): Connection =>
  !initial.test
    ? { status: "untested" }
    : initial.test.ok
      ? { status: "connected", model: initial.model, seconds: initial.test.seconds ?? 0, at: initial.test.at }
      : { status: "failed", message: initial.test.error ?? "The connection test failed.", at: initial.test.at };

/**
 * Settings → AI provider (E6-3, SET-1, SET-2, E34-4). Each field saves on
 * its own: picking a card or a model right away, typing once you pause.
 * A saved key shows its last four characters, and Replace opens the field
 * (ST4). The connection test stays a button; its last result is kept.
 */
export function AiProviderSection({ initial }: { initial: AiSettingsView }) {
  const track = useTrackSave();
  const [provider, setProvider] = useState(initial.provider);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [model, setModel] = useState(initial.model);
  const [keyState, setKeyState] = useState(initial.keyState);
  const [keyEnding, setKeyEnding] = useState(initial.keyEnding);
  const [replacingKey, setReplacingKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [otherModel, setOtherModel] = useState(false);
  const [urlLeft, setUrlLeft] = useState(false);
  const [connection, setConnection] = useState<Connection>(() => savedConnection(initial));
  const [modelList, setModelList] = useState<ModelList>({ loading: true });
  const [timeoutInput, setTimeoutInput] = useState(initial.timeoutSeconds === null ? "" : String(initial.timeoutSeconds));
  const [timeoutProblem, setTimeoutProblem] = useState(false);
  const savedTimeout = useRef(initial.timeoutSeconds);
  const option = providerOption(provider);
  // What an empty Timeout means: the environment's, or the card's own.
  const fallbackTimeout = initial.envTimeoutSeconds ?? defaultTimeoutSeconds(provider);

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

  // The column beside the section follows the provider chosen here.
  useEffect(() => publishAiChoice({ provider, baseUrl }), [provider, baseUrl]);

  const fields = useMemo(() => ({ provider, baseUrl, model }), [provider, baseUrl, model]);
  const savedServer = useRef(`${initial.provider} ${initial.baseUrl}`);
  const { flush } = useAutosave(fields, async (value) => {
    const result = await track(saveAiProvider(value));
    if (result.ok) {
      setKeyState(result.data.keyState);
      setKeyEnding(result.data.keyEnding);
      if (result.data.keyRemoved) toast("The saved key was for another server, so it's removed. Enter the key for this one.");
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
    setReplacingKey(false);
    changed();
    setSaveNow((count) => count + 1);
  };

  const saveKey = async (change: { action: "set"; value: string } | { action: "clear" }) => {
    const result = toastResult(await track(saveApiKey({ provider, change })));
    if (!result.ok) return;
    setKeyState(result.data.keyState);
    setKeyEnding(result.data.keyEnding);
    setKeyInput("");
    setReplacingKey(false);
    changed();
    reloadModels();
  };

  // Public issue 118: empty goes back to the default; anything else is whole seconds within the limits.
  const saveTimeout = async () => {
    const typed = timeoutInput.trim();
    const seconds = typed === "" ? null : Number(typed);
    if (seconds !== null && !(Number.isInteger(seconds) && seconds >= AI_TIMEOUT_LIMITS.min && seconds <= AI_TIMEOUT_LIMITS.max)) {
      setTimeoutProblem(true);
      return;
    }
    setTimeoutProblem(false);
    if (seconds === savedTimeout.current) return;
    const result = toastResult(await track(saveAiTimeout({ seconds })));
    if (result.ok) savedTimeout.current = result.data.seconds;
  };

  const test = async () => {
    if (connection.status === "testing") return;
    if (keyInput.trim()) await saveKey({ action: "set", value: keyInput });
    // Actions run one after another, so pending saves land before the test.
    flush();
    setConnection({ status: "testing" });
    const result = await testAiConnection({});
    if (!result.ok) setConnection({ status: "failed", message: result.error, at: new Date().toISOString() });
    else if (result.data.connected) setConnection({ status: "connected", model: result.data.model, seconds: result.data.seconds, at: result.data.at });
    else setConnection({ status: "failed", message: result.data.message, at: result.data.at });
  };

  const models = [...new Set([...(modelList.loading ? [] : modelList.models), model].filter(Boolean))];

  return (
    <>
      <SettingsSectionIntro title="AI provider">
        The model that reads postings and writes your documents. A local one keeps everything on your hardware.
      </SettingsSectionIntro>

      <RadioGroup.Root
        aria-label="Provider"
        value={provider}
        onValueChange={(value) => chooseProvider(value as AiProvider)}
        className="grid grid-cols-1 gap-3 @md:grid-cols-2 @3xl:grid-cols-3"
      >
        {PROVIDER_OPTIONS.map((entry) => (
          <RadioGroup.Item
            key={entry.value}
            value={entry.value}
            aria-label={entry.name}
            aria-describedby={`provider-${entry.value}`}
            className="group flex items-start gap-3 rounded-card border border-line-card bg-card px-4 py-3.5 text-left hover:border-line-strong data-[state=checked]:border-primary data-[state=checked]:shadow-[0_0_0_1px_var(--color-primary)]"
          >
            <span
              aria-hidden
              className="mt-[3px] grid size-4 flex-none place-items-center rounded-full border-[1.5px] border-line-strong group-data-[state=checked]:border-primary"
            >
              <RadioGroup.Indicator className="size-2 rounded-full bg-primary" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[15px] font-medium">{entry.name}</span>
              <span id={`provider-${entry.value}`} className="flex flex-col gap-1">
                <span className="text-label text-muted">{whereLine(entry.value, entry.value === provider ? baseUrl : entry.defaultUrl, entry.value === provider)}</span>
                <span className="sr-only">.</span>{" "}
                <span className="text-label text-pretty text-muted">{entry.description}</span>
              </span>
            </span>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>

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
          (keyState === "set" || keyState === "env") && !replacingKey ? (
            // ST4: the saved key's last four characters, and Replace to type a new one.
            <div role="group" aria-labelledby="ai-key-label" className="flex flex-col gap-[7px]">
              <span id="ai-key-label" className="text-label font-medium">
                {option.apiKey.label}
              </span>
              <div className="flex items-center gap-2 rounded-control border border-line-input bg-input py-1 pr-1 pl-3">
                <span className="min-w-0 flex-1 truncate font-mono text-[13.5px]">
                  {keyState === "env" ? "From DOSSIER_AI_KEY" : keyEnding ? <><span aria-hidden="true">••••••••</span><span className="sr-only">Saved, ending in </span>{keyEnding}</> : "Saved"}
                </span>
                <Button variant="text" size="sm" onClick={() => setReplacingKey(true)}>
                  Replace
                </Button>
              </div>
              {keyState === "set" && (
                <Button variant="text" size="sm" className="self-start" onClick={() => void saveKey({ action: "clear" })}>
                  Remove saved key
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <Input
                label={option.apiKey.label}
                hint={keyState === "unreadable" ? undefined : option.apiKey.hint}
                type="password"
                autoComplete="off"
                autoFocus={replacingKey}
                value={keyInput}
                placeholder={replacingKey ? "Type the new key" : "Stored encrypted on your server"}
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
                  if (event.key === "Escape" && replacingKey) {
                    setKeyInput("");
                    setReplacingKey(false);
                  }
                }}
              />
              {replacingKey ? (
                <Button
                  variant="text"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    setKeyInput("");
                    setReplacingKey(false);
                  }}
                >
                  Keep the saved key
                </Button>
              ) : (
                keyState === "unreadable" && (
                  <Button variant="text" size="sm" className="self-start" onClick={() => void saveKey({ action: "clear" })}>
                    Remove saved key
                  </Button>
                )
              )}
            </div>
          )
        ) : (
          <div className="flex flex-col gap-[7px]">
            <span className="text-label text-muted">API key</span>
            <p className="py-[11px] text-sm text-muted">Not needed for a local model</p>
          </div>
        )}

        <Input
          label="Timeout, in seconds"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={timeoutInput}
          placeholder={String(fallbackTimeout)}
          error={timeoutProblem ? `A whole number of seconds, from ${AI_TIMEOUT_LIMITS.min} to ${AI_TIMEOUT_LIMITS.max.toLocaleString("en-US")}, or empty for ${fallbackTimeout}.` : undefined}
          hint={
            timeoutProblem
              ? undefined
              : initial.envTimeoutSeconds !== null
                ? `How long one request may take before Dossier gives up. Empty uses ${fallbackTimeout}, from DOSSIER_AI_TIMEOUT_SECONDS.`
                : `How long one request may take before Dossier gives up. Empty uses ${fallbackTimeout}, the default for ${option.local ? "a model on your own hardware" : "a hosted model"}.`
          }
          onChange={(event) => setTimeoutInput(event.target.value)}
          onBlur={() => void saveTimeout()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void saveTimeout();
            }
          }}
        />

        <div className="sm:col-span-2">
          <ConnectionStatus connection={connection} onTest={() => void test()} />
        </div>
      </Card>
    </>
  );
}

/** "today at 14:02", or "on 12 Nov": when the shown test ran. */
function testedWhen(at: string): string {
  const date = new Date(at);
  const now = new Date();
  return date.toDateString() === now.toDateString() ? `today at ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : `on ${formatShortDate(date, now)}`;
}

/**
 * The connection test (SET-2, E34-4): a button until it's run; then its
 * result in one line, success or error, with when and Test again. It's
 * kept, so it's still there next time, until the provider changes.
 */
function ConnectionStatus({ connection, onTest }: { connection: Connection; onTest: () => void }) {
  if (connection.status === "untested" || connection.status === "testing") {
    const testing = connection.status === "testing";
    return (
      <div className="flex flex-wrap items-center gap-3.5 pt-1">
        <Button variant="secondary" onClick={onTest} disabled={testing}>
          {testing ? "Testing…" : "Test connection"}
        </Button>
        <p role="status" className="text-control text-muted">
          {testing ? "Sending a short test prompt…" : "Not tested since your last change"}
        </p>
      </div>
    );
  }
  const ok = connection.status === "connected";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-control border px-4 py-3",
        ok ? "border-success/30 bg-success/8 text-success" : "border-error/30 bg-error/8 text-error",
      )}
    >
      <p role="status" className="flex min-w-0 flex-[1_1_280px] items-start gap-2 text-control text-pretty">
        <span aria-hidden="true" className="flex-none">
          {ok ? "✓" : "!"}
        </span>
        <span>
          {ok ? `Connected. ${connection.model} answered in ${connection.seconds.toLocaleString("en-US")} s` : connection.message}
          <span className="text-muted"> · tested {testedWhen(connection.at)}</span>
        </span>
      </p>
      <Button variant="text" size="sm" onClick={onTest}>
        Test again
      </Button>
    </div>
  );
}
