import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeStatus } from "@/components/change-status";
import type { ApplicationRow } from "@/lib/applications-data";
import { DEFAULT_SORT } from "@/lib/applications-list";

import { ApplicationsScreen } from "./applications-screen";

vi.mock("./actions", () => ({ rememberListView: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => null }));
vi.mock("@/components/change-status", () => ({ changeStatus: vi.fn(async () => true) }));

const row = (id: string, extra: Partial<ApplicationRow> = {}): ApplicationRow => ({
  id,
  company: "Ledgerly",
  role: "Senior Product Designer",
  location: "Amsterdam",
  mode: "Hybrid",
  status: "SENT",
  archived: false,
  deadline: null,
  match: { hit: 5, total: 7 },
  sent: "20 Sep",
  updated: "2 days ago",
  updatedAt: Date.UTC(2026, 8, 26),
  ...extra,
});

const rows = [
  row("kestrel", { company: "Kestrel Maps", role: "Product Designer, Mobile", updatedAt: Date.UTC(2026, 8, 20), updated: "8 days ago", match: null }),
  row("meridian", { company: "Meridian Bank", role: "Product Designer, Onboarding", location: "", mode: "Remote" }),
  row("brightline", { company: "Brightline Transit", status: "DRAFT", deadline: "3 Oct 2026" }),
  row("oaken", { company: "Oaken Studio", status: "OFFER" }),
];
const params = { view: "board" as const, filter: "all" as const, q: "", sort: DEFAULT_SORT, archived: false };
const open = (extra = {}) =>
  render(<ApplicationsScreen params={params} rows={rows} counts={{ all: 4, active: 4, closed: 0 }} summary="4 applications" empty={false} archivedCount={0} {...extra} />);
const column = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name} `) });

beforeEach(() => vi.mocked(changeStatus).mockClear());

describe("the board (E9-2)", () => {
  it("has a column per status in the filter, with counts", () => {
    open();
    expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-labelledby"))).toEqual([
      "board-DRAFT",
      "board-SENT",
      "board-SCREENING",
      "board-INTERVIEW",
      "board-OFFER",
      "board-ACCEPTED",
      "board-REJECTED",
      "board-DECLINED",
    ]);
    expect(column("Sent")).toHaveAccessibleName("Sent 2 applications");
    expect(within(column("Screening")).getByText("Nothing here yet")).toBeInTheDocument();
  });

  it("shows only the filter's columns", () => {
    open({ params: { ...params, filter: "closed" }, rows: [] });
    expect(screen.getByText("Nothing in this view yet.")).toBeInTheDocument();
    open({ params: { ...params, filter: "closed" }, rows: [row("q", { status: "DECLINED" })] });
    expect(screen.getAllByRole("region")).toHaveLength(3);
  });

  it("puts the latest update first, with each card's details", () => {
    open();
    const cards = within(column("Sent")).getAllByRole("listitem");
    expect(cards.map((card) => within(card).getByRole("link").textContent)).toEqual(["Product Designer, Onboarding", "Product Designer, Mobile"]);
    expect(cards[0]).toHaveTextContent("Meridian BankProduct Designer, OnboardingRemote5/7 match2 days ago");
    expect(cards[1]).toHaveTextContent("Kestrel MapsProduct Designer, MobileAmsterdam · HybridNot matched8 days ago");
    expect(within(cards[0]).getByRole("link")).toHaveAttribute("href", "/applications/meridian");
  });

  it("flags a draft's deadline", () => {
    open();
    expect(within(column("Draft")).getByText("Apply by 3 Oct 2026")).toBeInTheDocument();
    expect(within(column("Sent")).queryByText(/^Apply by/)).not.toBeInTheDocument();
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
});
