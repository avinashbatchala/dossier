"use client";

import { Switch } from "radix-ui";
import { useId, useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/cn";
import { CHANNEL_INFO, CHANNEL_TYPES, ntfyWarning, type ChannelType, type ChannelView, type DeliveryView, type EmailConfig, type NtfyConfig, type WebhookConfig } from "@/lib/notifications/channels";
import { EVENT_NAMES, EVENTS, type EventName } from "@/lib/notifications/events";

import {
  copyWebhookSecret,
  deleteNotificationChannel,
  regenerateNotificationSecret,
  resumeNotificationChannel,
  saveNotificationChannel,
  setNotificationEvent,
  setNotificationOnlyNew,
  testNotificationChannel,
} from "./notifications-actions";
import { SettingsSectionIntro } from "./settings-screen";

export type NotificationsView = { channels: ChannelView[]; log: DeliveryView[] };

/**
 * Settings → Notifications (E26, #416–#418): the channels messages go to,
 * which event goes where, and the last 50 deliveries. Each change saves on
 * its own; secrets are never shown again, but a webhook's when copied.
 */
export function NotificationsSection({ initial }: { initial: NotificationsView }) {
  const [channels, setChannels] = useState(initial.channels);
  const [log, setLog] = useState(initial.log);
  const [editing, setEditing] = useState<ChannelView | "new" | null>(null);
  const replace = (channel: ChannelView) => setChannels((list) => (list.some((entry) => entry.id === channel.id) ? list.map((entry) => (entry.id === channel.id ? channel : entry)) : [...list, channel]));

  return (
    <>
      <SettingsSectionIntro title="Notifications">
        Dossier tells you when something happens, such as the job agent finishing a run, by email, a webhook or ntfy. Messages never carry your profile, documents, postings&apos; text or mail.
      </SettingsSectionIntro>

      <section aria-labelledby="channels-heading" className="flex flex-col gap-3">
        <h3 id="channels-heading" className="text-field font-medium">
          Channels
        </h3>
        {channels.length === 0 && editing === null && <p className="text-sm text-muted">No channels yet. Add one to start getting messages.</p>}
        {channels.map((channel) =>
          editing !== "new" && editing?.id === channel.id ? (
            <ChannelForm
              key={channel.id}
              channel={channel}
              onSaved={(saved) => {
                replace(saved);
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <ChannelCard
              key={channel.id}
              channel={channel}
              onChange={replace}
              onLog={setLog}
              onEdit={() => setEditing(channel)}
              onDeleted={() => setChannels((list) => list.filter((entry) => entry.id !== channel.id))}
            />
          ),
        )}
        {editing === "new" ? (
          <ChannelForm
            channel={null}
            onSaved={(saved) => {
              replace(saved);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <Button variant="secondary" className="self-start" onClick={() => setEditing("new")} disabled={editing !== null}>
            Add channel
          </Button>
        )}
      </section>

      {channels.length > 0 && <EventGrid channels={channels} onChange={replace} />}

      <DeliveryLog log={log} />
    </>
  );
}

type Draft = { type: ChannelType; name: string; host: string; port: string; user: string; from: string; to: string; url: string; server: string; topic: string; secret: string };

function draftOf(channel: ChannelView | null): Draft {
  const empty: Draft = { type: "EMAIL", name: "", host: "", port: "587", user: "", from: "", to: "", url: "", server: "https://ntfy.sh", topic: "", secret: "" };
  if (!channel) return empty;
  if (channel.type === "EMAIL") {
    const config = channel.config as EmailConfig;
    return { ...empty, type: "EMAIL", name: channel.name, host: config.host, port: String(config.port), user: config.user, from: config.from, to: config.to };
  }
  if (channel.type === "WEBHOOK") return { ...empty, type: "WEBHOOK", name: channel.name, url: (channel.config as WebhookConfig).url };
  const config = channel.config as NtfyConfig;
  return { ...empty, type: "NTFY", name: channel.name, server: config.server, topic: config.topic };
}

/** Add channel, or Edit: the type first, then its settings and its secret. */
function ChannelForm({ channel, onSaved, onCancel }: { channel: ChannelView | null; onSaved: (channel: ChannelView) => void; onCancel: () => void }) {
  const track = useTrackSave();
  const typeId = useId();
  const [draft, setDraft] = useState(() => draftOf(channel));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const patch = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));
  const secretLabel = CHANNEL_INFO[draft.type].secret;
  const warning = draft.type === "NTFY" ? ntfyWarning({ server: draft.server, topic: draft.topic }, Boolean(draft.secret.trim()) || Boolean(channel?.hasSecret)) : null;

  const save = async () => {
    setSaving(true);
    setError(null);
    const config =
      draft.type === "EMAIL"
        ? { host: draft.host, port: draft.port, user: draft.user, from: draft.from, to: draft.to }
        : draft.type === "WEBHOOK"
          ? { url: draft.url }
          : { server: draft.server, topic: draft.topic };
    const secret = draft.type !== "WEBHOOK" && draft.secret.trim() ? { action: "set" as const, value: draft.secret } : { action: "keep" as const };
    const result = await track(saveNotificationChannel({ id: channel?.id, type: draft.type, name: draft.name, config, secret }));
    setSaving(false);
    if (!result.ok) return setError(result.error);
    onSaved(result.data);
  };

  return (
    <Card>
      <form
        aria-label={channel ? `Edit ${channel.name}` : "New channel"}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!saving) void save();
        }}
      >
        {!channel && (
          <div className="flex flex-col gap-2">
            <span id={typeId} className="text-field">
              Type
            </span>
            <SegmentedControl aria-labelledby={typeId} options={CHANNEL_TYPES.map((type) => ({ value: type, label: CHANNEL_INFO[type].label }))} value={draft.type} onValueChange={(type) => patch({ type, secret: "" })} />
            <p className="text-meta text-muted">{CHANNEL_INFO[draft.type].hint}</p>
          </div>
        )}
        <Input label="Name" hint="What the grid calls it." value={draft.name} maxLength={60} onChange={(event) => patch({ name: event.target.value })} />
        {draft.type === "EMAIL" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="SMTP server" placeholder="smtp.example.com" value={draft.host} onChange={(event) => patch({ host: event.target.value })} />
            <Input label="Port" inputMode="numeric" hint="587 for STARTTLS, 465 for TLS." value={draft.port} onChange={(event) => patch({ port: event.target.value })} />
            <Input label="User" autoComplete="off" value={draft.user} onChange={(event) => patch({ user: event.target.value })} />
            <Input label="From" type="email" placeholder="dossier@example.com" value={draft.from} onChange={(event) => patch({ from: event.target.value })} />
            <Input label="To" type="email" placeholder="you@example.com" value={draft.to} onChange={(event) => patch({ to: event.target.value })} />
          </div>
        )}
        {draft.type === "WEBHOOK" && (
          <Input
            label="Address"
            placeholder="https://n8n.example.com/webhook/…"
            hint="Each event goes there as JSON, with an X-Dossier-Signature header made with a secret Dossier makes. Addresses on your own network work too."
            value={draft.url}
            onChange={(event) => patch({ url: event.target.value })}
          />
        )}
        {draft.type === "NTFY" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Server" hint="ntfy.sh, or your own server." value={draft.server} onChange={(event) => patch({ server: event.target.value })} />
            <Input label="Topic" autoComplete="off" value={draft.topic} onChange={(event) => patch({ topic: event.target.value })} />
          </div>
        )}
        {secretLabel && (
          <Input
            label={draft.type === "NTFY" ? `${secretLabel} (optional)` : secretLabel}
            type="password"
            autoComplete="off"
            placeholder={channel?.hasSecret ? "Saved · type a new one to replace it" : undefined}
            hint="Stored encrypted on your server, and never shown again."
            value={draft.secret}
            onChange={(event) => patch({ secret: event.target.value })}
          />
        )}
        {warning && (
          <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
            {warning}
          </p>
        )}
        {error && (
          <p role="alert" className="text-meta text-error">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" aria-disabled={saving || undefined}>
            {saving ? "Saving…" : channel ? "Save channel" : "Add channel"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

type TestState = { state: "idle" } | { state: "sending" } | { state: "sent" } | { state: "failed"; message: string };

function ChannelCard({
  channel,
  onChange,
  onLog,
  onEdit,
  onDeleted,
}: {
  channel: ChannelView;
  onChange: (channel: ChannelView) => void;
  onLog: (log: DeliveryView[]) => void;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const track = useTrackSave();
  const [test, setTest] = useState<TestState>({ state: "idle" });
  const [deleting, setDeleting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const sendTest = async () => {
    setTest({ state: "sending" });
    const result = toastResult(await testNotificationChannel({ id: channel.id }));
    if (!result.ok) return setTest({ state: "idle" });
    onLog(result.data.log);
    setTest(result.data.result.ok ? { state: "sent" } : { state: "failed", message: result.data.result.error });
  };
  const copySecret = async () => {
    const result = toastResult(await copyWebhookSecret({ id: channel.id }));
    if (!result.ok) return;
    await navigator.clipboard.writeText(result.data).then(
      () => toast("Copied the signing secret."),
      () => toast("The secret couldn't be copied. Allow the clipboard and try again."),
    );
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[15px] font-medium">{channel.name}</h4>
        <span className="min-w-0 truncate text-meta text-muted">
          {CHANNEL_INFO[channel.type].label} · {channel.summary}
        </span>
      </div>
      {channel.pausedAt && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
          <span>Paused after {channel.failuresInARow} failed deliveries in a row. The delivery log says why.</span>
          <Button variant="secondary" size="sm" onClick={() => void track(resumeNotificationChannel({ id: channel.id })).then((result) => result.ok && onChange(result.data))}>
            Resume
          </Button>
        </div>
      )}
      {channel.warning && (
        <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
          {channel.warning}
        </p>
      )}
      <Toggle
        label="Only when there's something new"
        description="An agent run that found nothing new and had no failures sends nothing."
        checked={channel.onlyNew}
        onCheckedChange={(onlyNew) => {
          onChange({ ...channel, onlyNew });
          void track(setNotificationOnlyNew({ id: channel.id, onlyNew })).then((result) => {
            const settled = toastResult(result);
            if (settled.ok) onChange(settled.data);
          });
        }}
      />
      {channel.type === "WEBHOOK" && (
        <div className="flex flex-wrap items-center gap-2 text-meta text-muted">
          <span>Signing secret, for checking X-Dossier-Signature:</span>
          <Button variant="secondary" size="sm" onClick={() => void copySecret()}>
            Copy secret
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setRegenerating(true)}>
            Regenerate
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" aria-disabled={test.state === "sending" || undefined} onClick={() => test.state !== "sending" && void sendTest()}>
          {test.state === "sending" ? "Sending…" : "Send a test"}
        </Button>
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setDeleting(true)}>
          Delete
        </Button>
      </div>
      <p role="status" className={cn("text-meta empty:hidden", test.state === "failed" ? "text-error" : test.state === "sent" ? "text-success" : "text-muted")}>
        {test.state === "sent" ? "Sent: check that it arrived." : test.state === "failed" ? test.message : ""}
      </p>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${channel.name}”?`}
        description="It stops getting messages, and its deliveries leave the log."
        confirmLabel="Delete channel"
        onConfirm={() => void track(deleteNotificationChannel({ id: channel.id })).then((result) => toastResult(result).ok && onDeleted())}
      />
      <ConfirmDialog
        open={regenerating}
        onOpenChange={setRegenerating}
        title="Make a new signing secret?"
        description="The old one stops working at once: update it where the webhook's signature is checked."
        confirmLabel="Make a new secret"
        onConfirm={() =>
          void track(regenerateNotificationSecret({ id: channel.id })).then((result) => {
            if (toastResult(result).ok) toast("Made a new signing secret. Copy it to where the signature is checked.");
          })
        }
      />
    </Card>
  );
}

/** The grid (E26-3): events as rows, channels as columns, a switch in each cell. */
function EventGrid({ channels, onChange }: { channels: ChannelView[]; onChange: (channel: ChannelView) => void }) {
  const track = useTrackSave();
  const toggle = (channel: ChannelView, event: EventName, on: boolean) => {
    onChange({ ...channel, events: { ...channel.events, [event]: on } });
    void track(setNotificationEvent({ id: channel.id, event, on })).then((result) => {
      const settled = toastResult(result);
      if (settled.ok) onChange(settled.data);
    });
  };
  return (
    <section aria-labelledby="grid-heading" className="flex flex-col gap-3">
      <h3 id="grid-heading" className="text-field font-medium">
        What goes where
      </h3>
      <div className="overflow-x-auto rounded-card border border-line-card bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="px-4 py-2.5 font-medium">
                Event
              </th>
              {channels.map((channel) => (
                <th key={channel.id} scope="col" className="px-4 py-2.5 text-center font-medium">
                  {channel.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {EVENT_NAMES.map((name) => (
              <tr key={name} className="border-b border-line last:border-b-0">
                <th scope="row" className="px-4 py-2.5 text-left font-normal">
                  <span className="block">{EVENTS[name].label}</span>
                  <span className="block text-meta text-muted">{EVENTS[name].hint}</span>
                </th>
                {channels.map((channel) => (
                  <td key={channel.id} className="px-4 py-2.5 text-center">
                    <Switch.Root
                      aria-label={`${EVENTS[name].label}, to ${channel.name}`}
                      checked={channel.events[name]}
                      onCheckedChange={(on) => toggle(channel, name, on)}
                      className="inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-toggle-off p-[3px] data-[state=checked]:bg-primary motion-safe:transition-colors"
                    >
                      <Switch.Thumb className="block size-[18px] rounded-full bg-white shadow-knob data-[state=checked]:translate-x-4 data-[state=checked]:bg-on-primary motion-safe:transition-[transform,background-color]" />
                    </Switch.Root>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const STATUS: Record<DeliveryView["status"], string> = { SENT: "Sent", FAILED: "Failed", PENDING: "Waiting to try again", SENDING: "Sending" };

/** The delivery log: the last 50 messages, newest first. */
function DeliveryLog({ log }: { log: DeliveryView[] }) {
  return (
    <section aria-labelledby="log-heading" className="flex flex-col gap-3">
      <h3 id="log-heading" className="text-field font-medium">
        Delivery log
      </h3>
      {log.length === 0 ? (
        <p className="text-sm text-muted">Nothing sent yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line-card bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["When", "Event", "Channel", "Result"].map((heading) => (
                  <th key={heading} scope="col" className="px-4 py-2.5 font-medium">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {log.map((delivery) => (
                <tr key={delivery.id} className="border-b border-line align-top last:border-b-0">
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">
                    <time dateTime={delivery.at}>{delivery.when}</time>
                  </td>
                  <td className="px-4 py-2.5">{delivery.event}</td>
                  <td className="px-4 py-2.5">{delivery.channel}</td>
                  <td className={cn("px-4 py-2.5", delivery.status === "FAILED" ? "text-error" : delivery.status === "SENT" ? "text-success" : "text-muted")}>
                    {STATUS[delivery.status]}
                    {delivery.status === "PENDING" && delivery.attempts > 0 ? ` (tried ${delivery.attempts} of 4)` : ""}
                    {delivery.error && delivery.status !== "SENT" ? `: ${delivery.error}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
