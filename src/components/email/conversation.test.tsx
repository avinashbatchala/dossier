import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import {
  applySuggestedStatus,
  confirmInterview,
  loadFreeSlots,
  markHandled,
  rereadEmail,
  sendReplyEmail,
  startDraftingReply,
} from "@/lib/google/actions";
import type { EmailView } from "@/lib/google/inbox-data";

import { Conversation } from "./conversation";

vi.mock("@/lib/google/actions", () => ({
  applySuggestedStatus: vi.fn(async () => ({ ok: true, data: { eventId: "ev" }, toast: "An interview! You've got this." })),
  confirmInterview: vi.fn(async () => ({ ok: true, data: { eventLink: null, eventId: null }, toast: "Interview added." })),
  loadFreeSlots: vi.fn(async () => ({ ok: true, data: { slots: [{ start: "2026-10-20T08:00:00.000Z", label: "Tue 20 Oct, 10:00–10:45" }, { start: "2026-10-21T12:00:00.000Z", label: "Wed 21 Oct, 14:00–14:45" }], timeZone: "Europe/Berlin", fromCalendar: true } })),
  markHandled: vi.fn(async () => ({ ok: true, data: null })),
  rereadEmail: vi.fn(async () => ({ ok: true, data: null })),
  saveReplyDraft: vi.fn(async () => ({ ok: true, data: null })),
  sendReplyEmail: vi.fn(async () => ({ ok: true, data: null, toast: "Answer sent." })),
  startDraftingReply: vi.fn(async () => ({ ok: true, data: "job-1" })),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));
vi.mock("@/components/change-status", () => ({ toastWithUndo: vi.fn() }));
const jobs = vi.hoisted(() => ({ listener: undefined as ((job: unknown) => void) | undefined }));
vi.mock("@/hooks/use-job", () => ({
  useJob: (id: string | null, _revision: number, onChange?: (job: unknown) => void) => {
    jobs.listener = id ? onChange : undefined;
    return null;
  },
}));

const email = (extra: Partial<EmailView> = {}): EmailView => ({
  id: "e1",
  threadId: "t1",
  direction: "INCOMING",
  fromName: "Anna Keller",
  fromAddress: "a.keller@northwind.example",
  subject: "Re: Application",
  body: "Could we do a call next week? What's your notice period?",
  sentAt: new Date("2026-10-17T13:02:00Z"),
  kind: "INTERVIEW",
  summary: "Invites you to a call and asks your notice period.",
  questions: ["What is your notice period?"],
  suggestedStatus: "INTERVIEW",
  confirmedAt: null,
  replyDraft: "",
  replyGaps: [],
  handled: false,
  read: true,
  application: { id: "nw", company: "Northwind", role: "Designer", status: "SENT" },
  ...extra,
});

beforeEach(() => {
  vi.mocked(toast).mockClear();
  vi.mocked(sendReplyEmail).mockClear();
  router.refresh.mockClear();
});

describe("Conversation (E15-3, E15-4)", () => {
  it("shows what the AI read and takes up the suggested status", async () => {
    const user = userEvent.setup();
    render(<Conversation emails={[email()]} aiReady timeZone="Europe/Berlin" />);
    expect(screen.getByText("Invites you to a call and asks your notice period.")).toBeInTheDocument();
    expect(screen.getByText("Interview invite")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move to Interview" }));
    expect(applySuggestedStatus).toHaveBeenCalledWith({ emailId: "e1", accept: true });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("drafts an answer with the picked free times, and sends it after review", async () => {
    const user = userEvent.setup();
    render(<Conversation emails={[email()]} aiReady timeZone="Europe/Berlin" />);
    const times = await screen.findByRole("group", { name: "Times to offer" });
    await user.click(within(times).getByRole("button", { name: "Wed 21 Oct, 14:00–14:45" }));
    await user.type(screen.getByRole("textbox", { name: "Tell the AI" }), "Notice is 3 months");
    await user.click(screen.getByRole("button", { name: "Draft an answer" }));
    expect(startDraftingReply).toHaveBeenCalledWith({ emailId: "e1", note: "Notice is 3 months", slots: ["2026-10-20T08:00:00.000Z"] });

    act(() => jobs.listener?.({ id: "job-1", status: "DONE", result: { body: "Hi Anna,\n\nTuesday works. My notice is […].", gaps: ["Start date?"], unverified: [], slots: [] } }));
    expect(screen.getByRole("textbox", { name: "Your answer" })).toHaveValue("Hi Anna,\n\nTuesday works. My notice is […].");
    expect(screen.getByText("Start date?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review and send" }));
    expect(toast).toHaveBeenCalledWith("Fill in the parts marked […] first.");
    const answer = screen.getByRole("textbox", { name: "Your answer" });
    await user.clear(answer);
    await user.type(answer, "Hi Anna, Tuesday works.");
    await user.click(screen.getByRole("button", { name: "Review and send" }));
    await user.click(screen.getByRole("button", { name: "Send now" }));
    expect(sendReplyEmail).toHaveBeenCalledWith({ emailId: "e1", body: "Hi Anna, Tuesday works." });
  });

  it("offers to add an agreed interview", async () => {
    const user = userEvent.setup();
    render(<Conversation emails={[email({ confirmedAt: new Date("2026-10-22T12:00:00Z"), suggestedStatus: null })]} aiReady timeZone="Europe/Berlin" />);
    expect(screen.getByRole("heading", { name: "Interview on 22 Oct, 14:00" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add interview" }));
    expect(confirmInterview).toHaveBeenCalledWith({ emailId: "e1", start: "2026-10-22T12:00:00.000Z", moveToInterview: true });
    expect(loadFreeSlots).not.toHaveBeenCalledTimes(2);
  });

  it("reads an unread mail on request, and reopens an answered one", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Conversation emails={[email({ read: false, kind: null })]} aiReady />);
    await user.click(screen.getByRole("button", { name: "Read it now" }));
    expect(rereadEmail).toHaveBeenCalledWith({ emailId: "e1" });
    rerender(<Conversation emails={[email({ handled: true, kind: "REJECTION", suggestedStatus: null })]} aiReady />);
    expect(screen.getByText(/No answer needed\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Answer anyway" }));
    expect(markHandled).toHaveBeenCalledWith({ emailId: "e1", handled: false });
  });

  it("collapses older messages to their summary", async () => {
    const user = userEvent.setup();
    const sent = email({ id: "out", direction: "OUTGOING", body: "I'm applying.", summary: "", kind: null, handled: true, sentAt: new Date("2026-10-12T09:00:00Z") });
    render(<Conversation emails={[sent, email()]} aiReady={false} />);
    const [first] = screen.getAllByRole("button", { expanded: false });
    expect(first).toHaveTextContent("You");
    await user.click(first);
    expect(screen.getByText("I'm applying.")).toBeInTheDocument();
  });
});
