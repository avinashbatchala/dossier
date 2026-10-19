import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { checkInbox, dismissEmail, linkEmail } from "@/lib/google/actions";
import type { EmailView } from "@/lib/google/inbox-data";

import { InboxScreen } from "./inbox-screen";

vi.mock("@/lib/google/actions", () => ({
  checkInbox: vi.fn(async () => ({ ok: true, data: null })),
  dismissEmail: vi.fn(async () => ({ ok: true, data: null })),
  linkEmail: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/inbox" }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const email = (extra: Partial<EmailView>): EmailView => ({
  id: "e1",
  threadId: "t1",
  direction: "INCOMING",
  fromName: "Anna Keller",
  fromAddress: "anna@northwind.example",
  subject: "Re: Application",
  body: "Could we talk?",
  sentAt: new Date("2026-10-17T13:02:00Z"),
  kind: "INTERVIEW",
  summary: "Invites you to a call.",
  questions: [],
  suggestedStatus: null,
  confirmedAt: null,
  replyDraft: "",
  replyGaps: [],
  handled: false,
  read: true,
  application: { id: "nw", company: "Northwind", role: "Designer", status: "SENT" },
  ...extra,
});

const inbox = {
  waiting: [email({})],
  unmatched: [email({ id: "e2", fromName: "Acme Talent", subject: "A role for you", application: null, kind: null })],
  updates: [email({ id: "e3", kind: "REJECTION", handled: true, summary: "Won't go ahead." })],
};

describe("InboxScreen (E15-3)", () => {
  it("lists replies waiting, unmatched mail and updates", async () => {
    const user = userEvent.setup();
    render(<InboxScreen inbox={inbox} connected configured lastSync={new Date("2026-10-18T10:00:00Z")} problem={null} aiReady timeZone="UTC" applications={[{ id: "nw", label: "Northwind, Designer" }]} />);
    const waiting = screen.getByRole("region", { name: "Needs an answer" });
    expect(within(waiting).getByRole("link")).toHaveAttribute("href", "/applications/nw?tab=conversation");
    expect(within(waiting).getByText("Invites you to a call.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Updates" })).toHaveTextContent("Won't go ahead.");
    expect(screen.getByText("Checked 18 Oct, 10:00")).toBeInTheDocument();

    const unmatched = screen.getByRole("region", { name: "Needs a look" });
    await user.selectOptions(within(unmatched).getByRole("combobox", { name: "Link to application" }), "nw");
    await user.click(within(unmatched).getByRole("button", { name: "Link" }));
    expect(linkEmail).toHaveBeenCalledWith({ emailId: "e2", applicationId: "nw" });
    await user.click(within(unmatched).getByRole("button", { name: "Not job-related" }));
    expect(dismissEmail).toHaveBeenCalledWith({ emailId: "e2" });
    await user.click(screen.getByRole("button", { name: "Check now" }));
    expect(checkInbox).toHaveBeenCalled();
  });

  it("points to Settings until Gmail is connected", () => {
    render(<InboxScreen inbox={{ waiting: [], unmatched: [], updates: [] }} connected={false} configured={false} lastSync={null} problem={null} aiReady applications={[]} />);
    expect(screen.getByRole("link", { name: "Set up Google" })).toHaveAttribute("href", "/settings?section=google");
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });
});
