import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardFigures } from "@/lib/dashboard";

import { rememberQuietDays } from "./actions";
import { Dashboard } from "./dashboard";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => null }));
vi.mock("./actions", () => ({ rememberDashboardPeriod: vi.fn(), rememberQuietDays: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const figures: DashboardFigures = {
  total: 9,
  byStatus: { DRAFT: 2, SENT: 2, SCREENING: 1, INTERVIEW: 1, OFFER: 1, ACCEPTED: 0, REJECTED: 1, DECLINED: 1 },
  funnel: [
    { stage: "SENT", count: 7, conversion: null, stopped: { open: 2, rejected: 0, declined: 0, archived: 0 } },
    { stage: "SCREENING", count: 5, conversion: 71, stopped: { open: 1, rejected: 1, declined: 0, archived: 0 } },
    { stage: "INTERVIEW", count: 3, conversion: 60, stopped: { open: 1, rejected: 0, declined: 0, archived: 0 } },
    { stage: "OFFER", count: 2, conversion: 67, stopped: { open: 1, rejected: 0, declined: 1, archived: 0 } },
    { stage: "ACCEPTED", count: 0, conversion: 0, stopped: { open: 0, rejected: 0, declined: 0, archived: 0 } },
  ],
  sent: 7,
  heardBack: 5,
  heardBackPercent: 71,
  reachedInterview: 3,
  attention: [
    { id: "oaken", company: "Oaken Studio", role: "Design Systems Lead", status: "OFFER", reason: "An offer is waiting on your decision.", action: "Review" },
    { id: "brightline", company: "Brightline Transit", role: "Senior Service Designer", status: "DRAFT", reason: "Still a draft, and applications close 3 Oct.", action: "Finish" },
  ],
  weeks: [],
};
const props = { figures, firstName: "Jane", period: "afternoon" as const, empty: false };

afterEach(() => vi.useRealTimers());

describe("the dashboard (E9-7)", () => {
  it("greets by the local time and sums up the search", () => {
    vi.useFakeTimers({ now: new Date(2026, 8, 28, 9), toFake: ["Date"] });
    render(<Dashboard {...props} />);
    expect(screen.getByRole("heading", { level: 1, name: "Good morning, Jane" })).toBeInTheDocument();
    expect(screen.getByText("You've sent 7 applications and heard back from 5. That's a solid run. Keep it going.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ New application" })).toHaveAttribute("href", "/new?fresh=1");
    expect(document.cookie).toMatch(/dossier-tz=/);
  });

  it("encourages before anything was sent", () => {
    render(<Dashboard {...props} figures={{ ...figures, sent: 0, heardBack: 0, heardBackPercent: null }} />);
    expect(screen.getByText("Nothing sent yet. Your first application is only a paste away.")).toBeInTheDocument();
  });

  it("says which period the summary covers (E9-8)", () => {
    const { rerender } = render(<Dashboard {...props} range="30d" />);
    expect(screen.getByText("In the last 30 days you've sent 7 applications and heard back from 5. That's a solid run. Keep it going.")).toBeInTheDocument();
    rerender(<Dashboard {...props} range="90d" figures={{ ...figures, sent: 0, heardBack: 0, heardBackPercent: null }} />);
    expect(screen.getByText("Nothing sent in the last 90 days. Your next application is only a paste away.")).toBeInTheDocument();
  });

  it("shows the funnel with its figures and notes, in words", () => {
    render(<Dashboard {...props} />);
    const funnel = screen.getByRole("region", { name: "Your funnel" });
    expect(within(funnel).getAllByRole("definition").map((value) => value.textContent)).toEqual(["7", "71%", "3"]);
    expect(within(funnel).getAllByRole("listitem").map((step) => step.textContent)).toEqual([
      "Sent7Everything you've sent",
      "Screening571% of sent",
      "Interview360% of screening",
      "Offer267% of interview",
      "Accepted0None yet",
    ]);
  });

  it("breaks down where things stand, with a link to the board", () => {
    render(<Dashboard {...props} />);
    const standing = screen.getByRole("region", { name: "Where things stand" });
    expect(within(standing).getByRole("link", { name: "Open board" })).toHaveAttribute("href", "/applications?view=board");
    const accepted = within(standing).getByText("Accepted").closest("li")!;
    expect(accepted).toHaveTextContent("Accepted0");
    expect(accepted).toHaveClass("text-muted");
  });

  it("lists what's worth a look, each opening its application", () => {
    render(<Dashboard {...props} />);
    const attention = screen.getByRole("region", { name: "Worth a look" });
    expect(within(attention).getByText("2 things")).toBeInTheDocument();
    const [offer] = within(attention).getAllByRole("link");
    expect(offer).toHaveAttribute("href", "/applications/oaken");
    expect(offer).toHaveTextContent("Oaken Studio, Design Systems LeadAn offer is waiting on your decision.Review →");
  });

  it("flags an interview today or tomorrow (E9-9)", () => {
    const interview = {
      id: "northstar",
      company: "Northstar Health",
      role: "Lead Product Designer",
      status: "INTERVIEW" as const,
      reason: "Interview tomorrow at 14:00. Worth re-reading your tailored letter first.",
      action: "Open" as const,
      soon: true,
    };
    render(<Dashboard {...props} figures={{ ...figures, attention: [interview, ...figures.attention] }} />);
    const [first, second] = within(screen.getByRole("region", { name: "Worth a look" })).getAllByRole("link");
    expect(first).toHaveTextContent("Northstar Health, Lead Product DesignerSoonInterview tomorrow at 14:00.");
    expect(second).not.toHaveTextContent("Soon");
  });

  it("sets how long without news before a follow-up is suggested (E9-9)", async () => {
    const user = userEvent.setup();
    render(<Dashboard {...props} quietDays={7} />);
    const threshold = within(screen.getByRole("region", { name: "Worth a look" })).getByLabelText("Suggest a follow-up after");
    expect(threshold).toHaveValue("7");
    expect(within(threshold).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "3 days",
      "5 days",
      "7 days",
      "10 days",
      "14 days",
      "21 days",
      "30 days",
    ]);
    await user.selectOptions(threshold, "14");
    expect(rememberQuietDays).toHaveBeenCalledWith({ days: 14 });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("keeps a threshold that isn't one of the choices", () => {
    render(<Dashboard {...props} quietDays={8} />);
    expect(screen.getByLabelText("Suggest a follow-up after")).toHaveValue("8");
  });

  it("is all caught up when nothing needs attention", () => {
    render(<Dashboard {...props} figures={{ ...figures, attention: [] }} />);
    expect(screen.getByText("All caught up. Nice.")).toBeInTheDocument();
  });

  it("welcomes a new user", () => {
    render(<Dashboard {...props} empty figures={{ ...figures, sent: 0 }} />);
    expect(screen.getByRole("heading", { name: "Welcome to Dossier" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fill in your profile" })).toHaveAttribute("href", "/profile");
    expect(screen.queryByRole("region", { name: "Your funnel" })).not.toBeInTheDocument();
  });
});
