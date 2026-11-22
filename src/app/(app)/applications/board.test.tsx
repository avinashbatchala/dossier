import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeStatus } from "@/components/change-status";
import { toast } from "@/components/toast";
import type { ApplicationRow } from "@/lib/applications-data";
import { DEFAULT_SORT, sidebarStatuses } from "@/lib/applications-list";

import { setInterviewDate } from "./[id]/actions";
import { reorderBoard } from "./actions";
import { ApplicationsScreen } from "./applications-screen";
import { applicationRow } from "@/test/application-row";

vi.mock("./actions", () => ({
  rememberListView: vi.fn(async () => ({ ok: true, data: null })),
  reorderBoard: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => null }));
vi.mock("@/components/change-status", () => ({ changeStatus: vi.fn(async () => true) }));
vi.mock("./[id]/actions", () => ({ setInterviewDate: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({
  toast: vi.fn(),
  toastResult: (result: { ok: boolean; error?: string }) => {
    if (!result.ok) toast(result.error!);
    return result;
  },
}));

const row = (id: string, extra: Partial<ApplicationRow> = {}): ApplicationRow => applicationRow(id, extra);

const rows = [
  row("kestrel", { company: "Kestrel Maps", role: "Product Designer, Mobile", updatedAt: Date.UTC(2026, 8, 20), updated: "8 days ago", match: null }),
  row("meridian", { company: "Meridian Bank", role: "Product Designer, Onboarding", location: "", mode: "Remote" }),
  row("brightline", {
    company: "Brightline Transit",
    status: "DRAFT",
    deadline: "3 Oct 2026",
    flag: { kind: "apply-by", text: "Apply by Sat 3 Oct · 3 days", due: new Date("2026-10-03T00:00:00Z"), soon: true },
  }),
  row("oaken", { company: "Oaken Studio", status: "OFFER" }),
];
const params = { view: "board" as const, status: null, q: "", sort: DEFAULT_SORT, archived: false };
const open = (extra = {}) =>
  render(<ApplicationsScreen params={params} rows={rows} tabs={{ all: 4, statuses: sidebarStatuses(new Map()) }} summary="4 applications" empty={false} archivedCount={0} {...extra} />);
const column = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name} `) });

beforeEach(() => vi.mocked(changeStatus).mockClear());

describe("the board (E9-2)", () => {
  it("has a lane per status in progress, with counts, and the closed ones folded on the right (E29-3, LB2)", () => {
    open();
    expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-labelledby") ?? region.getAttribute("aria-label"))).toEqual([
      "board-DRAFT",
      "board-SENT",
      "board-SCREENING",
      "board-INTERVIEW",
      "board-OFFER",
      "Accepted, folded",
      "Rejected, folded",
      "Declined, folded",
    ]);
    expect(column("Sent")).toHaveAccessibleName("Sent 2 applications");
    // An empty lane says what dropping there does.
    expect(within(column("Screening")).getByText("Drop a card here when they get back to you.")).toBeInTheDocument();
    expect(within(column("Sent")).getByRole("link", { name: "Sent as a list" })).toHaveAttribute("href", "/applications?status=sent&view=list");
  });

  it("opens a folded lane on a click, and has them all open when Closed is on show", async () => {
    const user = userEvent.setup();
    const { unmount } = open();
    await user.click(screen.getByRole("button", { name: "Open 0 Declined" }));
    expect(column("Declined")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Rejected, folded" })).toBeInTheDocument();
    unmount();
    open({ params: { ...params, status: "closed" } });
    expect(screen.queryByRole("region", { name: /folded$/ })).not.toBeInTheDocument();
  });

  it("gives each lane its sub-line", () => {
    open({ laneNotes: { SCREENING: "71% heard back · 1 reply waiting" } });
    expect(within(column("Screening")).getByText("71% heard back · 1 reply waiting")).toBeInTheDocument();
  });

  it("keeps every lane with a status on show (E29-1)", () => {
    open({ params: { ...params, status: "closed" }, rows: [] });
    expect(screen.getByText("Nothing in this view yet.")).toBeInTheDocument();
    open({ params: { ...params, status: "closed" }, rows: [row("q", { status: "DECLINED" })] });
    expect(screen.getAllByRole("region")).toHaveLength(8);
  });

  it("puts the latest update first, with each card's details (E29-4)", () => {
    open();
    const cards = within(column("Sent")).getAllByRole("listitem");
    expect(cards.map((card) => within(card).getAllByRole("link")[0].textContent)).toEqual(["Product Designer, Onboarding", "Product Designer, Mobile"]);
    expect(cards[0]).toHaveTextContent("Meridian Bank5/7Product Designer, OnboardingRemote2 days ago");
    expect(within(cards[0]).getByRole("img", { name: "5 of 7 requirements covered" })).toBeInTheDocument();
    // No match yet: no ring.
    expect(within(cards[1]).queryByRole("img")).not.toBeInTheDocument();
    expect(within(cards[0]).getAllByRole("link")[0]).toHaveAttribute("href", "/applications/meridian");
  });

  it("flags what's next, in the warning colour when it's due this week, with a button that opens the right tab (E29-4)", () => {
    open();
    const draft = within(column("Draft")).getByRole("listitem");
    expect(within(draft).getByText("Apply by Sat 3 Oct · 3 days")).toHaveClass("text-warning");
    expect(within(draft).getByRole("link", { name: "Send for Senior Product Designer, Brightline Transit" })).toHaveAttribute("href", "/applications/brightline?tab=email");
    expect(within(within(column("Offer")).getByRole("listitem")).getByRole("link", { name: /^Review/ })).toHaveAttribute("href", "/applications/oaken");
    // A recent send has nothing to do yet.
    expect(within(column("Sent")).queryByRole("link", { name: /^Follow up/ })).not.toBeInTheDocument();
  });

  it("shows a card without a place on top, then the others in their order", () => {
    open({
      rows: [
        row("second", { role: "Second Role", status: "SENT", boardSort: 1, updatedAt: Date.UTC(2026, 8, 25) }),
        row("first", { role: "First Role", status: "SENT", boardSort: 0, updatedAt: Date.UTC(2026, 8, 1) }),
        row("new", { role: "New Role", status: "SENT", updatedAt: Date.UTC(2026, 8, 20) }),
      ],
    });
    expect(within(column("Sent")).getAllByRole("listitem").map((card) => within(card).getByRole("link").textContent)).toEqual([
      "New Role",
      "First Role",
      "Second Role",
    ]);
  });

  it("offers Move up and Move down only where the card can go", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Actions for Product Designer, Onboarding, Meridian Bank" }));
    expect(screen.getByRole("menuitem", { name: "Move up" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: "Move down" })).not.toHaveAttribute("aria-disabled");
  });

  it("says so when a new order can't be saved", async () => {
    const user = userEvent.setup();
    vi.mocked(reorderBoard).mockResolvedValueOnce({ ok: false, error: "Something went wrong." });
    open();
    await user.click(screen.getByRole("button", { name: "Actions for Product Designer, Onboarding, Meridian Bank" }));
    await user.click(screen.getByRole("menuitem", { name: "Move down" }));
    expect(toast).toHaveBeenCalledWith("Something went wrong.");
  });

  it("moves a card down from its menu, showing the new order at once and writing it", async () => {
    const user = userEvent.setup();
    let finish: (result: { ok: true; data: null }) => void = () => {};
    vi.mocked(reorderBoard).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    open();
    // Meridian is first in Sent (newest); moving it down puts Kestrel first.
    await user.click(screen.getByRole("button", { name: "Actions for Product Designer, Onboarding, Meridian Bank" }));
    await user.click(screen.getByRole("menuitem", { name: "Move down" }));

    expect(reorderBoard).toHaveBeenCalledWith({ status: "SENT", ids: ["kestrel", "meridian"] });
    const cards = within(column("Sent")).getAllByRole("listitem");
    expect(within(cards[0]).getByRole("link").textContent).toBe("Product Designer, Mobile");
    expect(within(cards[1]).getByRole("link").textContent).toBe("Product Designer, Onboarding");
    await act(async () => finish({ ok: true, data: null }));
  });

  it("moves a card from its Move to menu, showing it in the new column at once", async () => {
    const user = userEvent.setup();
    let finish: (moved: boolean) => void = () => {};
    vi.mocked(changeStatus).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    open();
    await user.click(screen.getByRole("button", { name: "Actions for Product Designer, Mobile, Kestrel Maps" }));
    await user.click(screen.getByRole("menuitemradio", { name: /Interview/ }));

    expect(changeStatus).toHaveBeenCalledWith("kestrel", "INTERVIEW");
    expect(within(column("Interview")).getByText("Kestrel Maps")).toBeInTheDocument();
    expect(within(column("Sent")).queryByText("Kestrel Maps")).not.toBeInTheDocument();
    finish(true);
  });

  describe("moving a card to Interview asks when it is (E29-5)", () => {
    const toInterview = async (user: ReturnType<typeof userEvent.setup>) => {
      // The move stays pending, as while the server answers: here the rows never change, so it would undo itself.
      vi.mocked(changeStatus).mockImplementationOnce(() => new Promise(() => {}));
      await user.click(screen.getByRole("button", { name: "Actions for Product Designer, Mobile, Kestrel Maps" }));
      await user.click(screen.getByRole("menuitemradio", { name: /Interview/ }));
      return screen.findByRole("dialog", { name: "When's the interview?" });
    };

    it("saves the date, in Google Calendar unless that's unticked (LB3)", async () => {
      const user = userEvent.setup();
      open({ calendar: true });
      const dialog = await toInterview(user);
      const box = within(dialog).getByRole("checkbox", { name: "Add to Google Calendar" });
      expect(box).toBeChecked();
      await user.click(box);
      fireEvent.change(within(dialog).getByLabelText("Date and time"), { target: { value: "2026-11-19T14:00" } });
      await user.click(within(dialog).getByRole("button", { name: "Save" }));
      expect(setInterviewDate).toHaveBeenCalledWith({ id: "kestrel", at: new Date("2026-11-19T14:00").toISOString(), calendar: false });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("has no calendar box without Google, and Not yet known closes it with the move kept", async () => {
      vi.mocked(setInterviewDate).mockClear();
      const user = userEvent.setup();
      open();
      const dialog = await toInterview(user);
      expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Not yet known" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(setInterviewDate).not.toHaveBeenCalled();
      expect(changeStatus).toHaveBeenCalledWith("kestrel", "INTERVIEW");
    });
  });

  it("picks out the lane it was opened on, until Esc (E29-6)", async () => {
    const user = userEvent.setup();
    open({ params: { ...params, status: "SENT" } });
    const sent = column("Sent");
    expect(sent).toHaveAttribute("aria-current", "true");
    expect(sent).toHaveClass("bg-selected");
    expect(within(sent).getByRole("link", { name: "show only Sent" })).toHaveAttribute("href", "/applications?status=sent&view=list");
    expect(column("Draft")).not.toHaveAttribute("aria-current");
    await user.keyboard("{Escape}");
    expect(column("Sent")).not.toHaveAttribute("aria-current");
    expect(within(column("Sent")).queryByText(/Opened from the sidebar/)).not.toBeInTheDocument();
  });
});
