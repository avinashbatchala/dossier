import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChannelView } from "@/lib/notifications/channels";
import { EVENT_NAMES, EVENTS } from "@/lib/notifications/events";

import { resumeNotificationChannel, saveNotificationChannel, setNotificationEvent, testNotificationChannel } from "./notifications-actions";
import { NotificationsSection } from "./notifications-section";

vi.mock("./notifications-actions", () => ({
  saveNotificationChannel: vi.fn(),
  deleteNotificationChannel: vi.fn(),
  setNotificationEvent: vi.fn(),
  setNotificationOnlyNew: vi.fn(),
  resumeNotificationChannel: vi.fn(),
  testNotificationChannel: vi.fn(),
  copyWebhookSecret: vi.fn(),
  regenerateNotificationSecret: vi.fn(),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const events = Object.fromEntries(EVENT_NAMES.map((name) => [name, EVENTS[name].on])) as ChannelView["events"];
const hook: ChannelView = { id: "c1", type: "WEBHOOK", name: "n8n", config: { url: "https://n8n.example/hook" }, summary: "https://n8n.example/hook", events, onlyNew: true, hasSecret: true, pausedAt: null, failuresInARow: 0, warning: null };

beforeEach(() => vi.clearAllMocks());

describe("Settings → Notifications (E26)", () => {
  it("adds a channel by its type, with ntfy's warning for a public topic", async () => {
    const user = userEvent.setup();
    render(<NotificationsSection initial={{ channels: [], log: [] }} />);
    expect(screen.getByText("No channels yet. Add one to start getting messages.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add channel" }));
    const form = within(screen.getByRole("form", { name: "New channel" }));
    await user.click(form.getByRole("radio", { name: "ntfy" }));
    await user.type(form.getByLabelText("Name"), "Phone");
    await user.type(form.getByLabelText("Topic"), "dossier");
    expect(form.getByRole("note")).toHaveTextContent("Anyone who knows this topic can read these messages.");
    await user.type(form.getByLabelText("Access token (optional)"), "tk_1");
    expect(form.queryByRole("note")).not.toBeInTheDocument();

    vi.mocked(saveNotificationChannel).mockResolvedValueOnce({ ok: true, data: { ...hook, id: "c2", type: "NTFY", name: "Phone", summary: "https://ntfy.sh/dossier" } });
    await user.click(form.getByRole("button", { name: "Add channel" }));
    expect(saveNotificationChannel).toHaveBeenCalledWith({ id: undefined, type: "NTFY", name: "Phone", config: { server: "https://ntfy.sh", topic: "dossier" }, secret: { action: "set", value: "tk_1" } });
    expect(await screen.findByRole("heading", { name: "Phone" })).toBeInTheDocument();
  });

  it("shows events as rows and channels as columns, each cell a switch", async () => {
    const user = userEvent.setup();
    render(<NotificationsSection initial={{ channels: [hook], log: [] }} />);
    const grid = screen.getByRole("table");
    expect(within(grid).getAllByRole("rowheader").map((header) => header.querySelector("span")?.textContent)).toEqual(EVENT_NAMES.map((name) => EVENTS[name].label));
    expect(within(grid).getByRole("switch", { name: "Agent run finished, to n8n" })).toBeChecked();
    expect(within(grid).getByRole("switch", { name: "A draft is ready, to n8n" })).not.toBeChecked();
    vi.mocked(setNotificationEvent).mockResolvedValueOnce({ ok: true, data: { ...hook, events: { ...events, "draft.ready": true } } });
    await user.click(within(grid).getByRole("switch", { name: "A draft is ready, to n8n" }));
    expect(setNotificationEvent).toHaveBeenCalledWith({ id: "c1", event: "draft.ready", on: true });
    expect(within(grid).getByRole("switch", { name: "A draft is ready, to n8n" })).toBeChecked();
  });

  it("sends a test and says what happened, and logs it", async () => {
    const user = userEvent.setup();
    render(<NotificationsSection initial={{ channels: [hook], log: [] }} />);
    expect(screen.getByText("Nothing sent yet.")).toBeInTheDocument();
    vi.mocked(testNotificationChannel).mockResolvedValueOnce({
      ok: true,
      data: {
        result: { ok: false, error: "The webhook answered 404: check the address." },
        log: [{ id: "d1", at: "2026-11-16T07:00:00.000Z", when: "16 Nov, 08:00", event: "Send a test", channel: "n8n", status: "FAILED", error: "The webhook answered 404: check the address.", attempts: 1 }],
      },
    });
    await user.click(screen.getByRole("button", { name: "Send a test" }));
    expect(await screen.findByText("The webhook answered 404: check the address.", { selector: "[role=status]" })).toBeInTheDocument();
    expect(within(screen.getAllByRole("table").at(-1)!).getByRole("row", { name: /Send a test n8n Failed: The webhook answered 404/ })).toBeInTheDocument();
  });

  it("says a channel is paused, and resumes it", async () => {
    const user = userEvent.setup();
    render(<NotificationsSection initial={{ channels: [{ ...hook, pausedAt: "2026-11-16T07:00:00.000Z", failuresInARow: 10 }], log: [] }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Paused after 10 failed deliveries in a row.");
    vi.mocked(resumeNotificationChannel).mockResolvedValueOnce({ ok: true, data: hook });
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(resumeNotificationChannel).toHaveBeenCalledWith({ id: "c1" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
