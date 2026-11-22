import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeStatus } from "@/components/change-status";
import { formatDateTime } from "@/lib/dates";

import { setInterviewDate } from "./actions";
import { ApplicationHeader } from "./application-header";
import { MarkAsSent, StatusControl } from "./status-control";

vi.mock("@/components/change-status", () => ({ changeStatus: vi.fn(async () => true) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));
vi.mock("./actions", () => ({ setInterviewDate: vi.fn(async () => ({ ok: true, data: null })) }));

beforeEach(() => {
  vi.mocked(changeStatus).mockClear();
  vi.mocked(setInterviewDate).mockClear();
});

describe("the application header (E30-2)", () => {
  const header = { role: "Senior Product Designer", company: "Ledgerly", title: "Senior Product Designer · Ledgerly", status: "DRAFT" as const, tabs: null, actions: null };

  it("has the breadcrumb with its status and flag as links (public issue 112), and “Role at Company”", () => {
    render(<ApplicationHeader {...header} flag={{ kind: "apply-by", text: "Apply by Thu 19 Nov · 3 days", due: new Date(), soon: true }} />);
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "Applications" })).toHaveAttribute("href", "/applications");
    expect(within(breadcrumb).getByRole("link", { name: "Draft" })).toHaveAttribute("href", "/applications?status=draft");
    expect(within(breadcrumb).getByText("apply by Thu 19 Nov · 3 days")).toHaveClass("text-warning");
    expect(screen.getByRole("heading", { level: 1, name: "Senior Product Designer at Ledgerly" })).toBeInTheDocument();
  });

  it("falls back to the title, and names an application without one", () => {
    const { rerender } = render(<ApplicationHeader {...header} role="" company="" flag={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Senior Product Designer · Ledgerly" })).toBeInTheDocument();
    rerender(<ApplicationHeader {...header} role="" company="" title=" " flag={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Untitled application" })).toBeInTheDocument();
  });
});

describe("the status control (E8-1)", () => {
  it("lists all eight statuses with the current one ticked", async () => {
    const user = userEvent.setup();
    render(<StatusControl id="app-1" status="INTERVIEW" />);
    await user.click(screen.getByRole("button", { name: "Status: Interview" }));

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Move this application to")).toBeInTheDocument();
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual([
      "Draft",
      "Sent",
      "Screening",
      "Interview✓",
      "Offer",
      "Accepted",
      "Rejected",
      "Declined",
    ]);
    expect(within(menu).getByRole("menuitemradio", { name: /Interview/ })).toHaveAttribute("aria-checked", "true");
  });

  it("moves the application from the keyboard and shows the new status at once", async () => {
    const user = userEvent.setup();
    let finish = () => {};
    vi.mocked(changeStatus).mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve(true))));
    render(<StatusControl id="app-1" status="SENT" />);

    const pill = screen.getByRole("button", { name: "Status: Sent" });
    pill.focus();
    await user.keyboard("{Enter}");
    // Sent is ticked, so focus starts on Draft: two steps down is Screening.
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(changeStatus).toHaveBeenCalledWith("app-1", "SCREENING");
    expect(screen.getByRole("button", { name: "Status: Screening" })).toHaveFocus();
    finish();
  });

  it("does nothing when the current status is picked again", async () => {
    const user = userEvent.setup();
    render(<StatusControl id="app-1" status="SENT" />);
    await user.click(screen.getByRole("button", { name: "Status: Sent" }));
    await user.click(screen.getByRole("menuitemradio", { name: /Sent/ }));
    expect(changeStatus).not.toHaveBeenCalled();
  });

  it("asks how it went out on “Mark as sent” (E29-7)", async () => {
    const user = userEvent.setup();
    render(<MarkAsSent id="app-1" />);
    await user.click(screen.getByRole("button", { name: "Mark as sent" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["By email", "On their site or a job portal", "Another way", "Just mark it as sent"]);
    await user.click(screen.getByRole("menuitem", { name: "By email" }));
    expect(changeStatus).toHaveBeenCalledWith("app-1", "SENT", "EMAIL");

    await user.click(screen.getByRole("button", { name: "Mark as sent" }));
    await user.click(screen.getByRole("menuitem", { name: "Just mark it as sent" }));
    expect(changeStatus).toHaveBeenLastCalledWith("app-1", "SENT");
  });
});

describe("the next interview's date (E9-9)", () => {
  it("asks for it after a move to Interview, and skipping is fine", async () => {
    const user = userEvent.setup();
    let finish = () => {};
    vi.mocked(changeStatus).mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve(true))));
    render(<StatusControl id="app-1" status="SCREENING" />);
    await user.click(screen.getByRole("button", { name: "Status: Screening" }));
    await user.click(screen.getByRole("menuitemradio", { name: /Interview/ }));

    const dialog = await screen.findByRole("dialog", { name: "When's the interview?" });
    expect(dialog).toHaveTextContent("Optional. It shows on your dashboard, flagged the day before.");
    expect(within(dialog).getByLabelText("Date and time")).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add the interview date" })).toHaveFocus();
    expect(setInterviewDate).not.toHaveBeenCalled();
    finish();
  });

  it("doesn't ask on other moves", async () => {
    const user = userEvent.setup();
    render(<StatusControl id="app-1" status="SENT" />);
    await user.click(screen.getByRole("button", { name: "Status: Sent" }));
    await user.click(screen.getByRole("menuitemradio", { name: /Screening/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("saves the date and time picked, in the browser's time zone", async () => {
    const user = userEvent.setup();
    render(<StatusControl id="app-1" status="INTERVIEW" />);
    await user.click(screen.getByRole("button", { name: "Add the interview date" }));
    const dialog = screen.getByRole("dialog", { name: "Next interview" });
    expect(within(dialog).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Date and time"), { target: { value: "2026-10-01T14:00" } });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(setInterviewDate).toHaveBeenCalledWith({ id: "app-1", at: new Date("2026-10-01T14:00").toISOString() });
  });

  it("shows a date that's set, and removes it", async () => {
    const user = userEvent.setup();
    const at = new Date("2026-10-01T12:00:00Z");
    render(<StatusControl id="app-1" status="INTERVIEW" interviewAt={at} />);
    const pill = screen.getByRole("button", { name: `Next interview: ${formatDateTime(at)}. Change` });
    expect(pill).toHaveTextContent(`Interview ${formatDateTime(at)}`);
    await user.click(pill);
    const dialog = screen.getByRole("dialog", { name: "Next interview" });
    expect(within(dialog).getByLabelText("Date and time")).toHaveValue(
      new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
    );
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(setInterviewDate).toHaveBeenCalledWith({ id: "app-1", at: null });
  });

  it("only shows while in Interview", () => {
    render(<StatusControl id="app-1" status="OFFER" interviewAt={new Date("2026-10-01T12:00:00Z")} />);
    expect(screen.queryByRole("button", { name: /interview/i })).not.toBeInTheDocument();
  });
});
