import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeStatus } from "@/components/change-status";
import type { ApplicationRow } from "@/lib/applications-data";
import { DEFAULT_SORT, type ListParams } from "@/lib/applications-list";

import { ApplicationsScreen } from "./applications-screen";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("./actions", () => ({ rememberListView: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => null }));
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
const rows = [row("kestrel", { company: "Kestrel Maps", role: "Product Designer, Mobile", match: null }), row("draft", { status: "DRAFT", sent: null, location: "" })];
const params: ListParams = { view: "table", filter: "all", q: "", sort: DEFAULT_SORT, archived: false };
const open = (extra: Partial<ListParams> = {}) =>
  render(<ApplicationsScreen params={{ ...params, ...extra }} rows={rows} counts={{ all: 2, active: 2, closed: 0 }} summary="2 applications" empty={false} archivedCount={0} />);

beforeEach(() => {
  router.push.mockClear();
  vi.mocked(changeStatus).mockClear();
});

describe("the table (E9-3)", () => {
  it("has the columns, sorted by the latest update", () => {
    open();
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Role",
      "Status",
      "Match",
      "Location",
      "Sent",
      "Updated ↓",
      "Actions",
    ]);
    expect(screen.getByRole("columnheader", { name: /Updated/ })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByText("Click a row to open it")).toBeInTheDocument();
  });

  it("shows each row's own status, match, location and dates", () => {
    open();
    const [kestrel, draft] = screen.getAllByRole("row").slice(1);
    expect(within(kestrel).getByRole("combobox", { name: "Status of Product Designer, Mobile, Kestrel Maps" })).toHaveValue("SENT");
    expect(within(draft).getByRole("combobox")).toHaveValue("DRAFT");
    expect(within(kestrel).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "Product Designer, MobileKestrel Maps",
      expect.stringContaining("Sent"),
      "Not matched",
      "Amsterdam",
      "20 Sep",
      "2 days ago",
      "⋯",
    ]);
    expect(within(draft).getAllByRole("cell").slice(2, 5).map((cell) => cell.textContent)).toEqual(["5/7", "Not given", "Not sent"]);
  });

  it("sorts by a column, and reverses on a second click", async () => {
    const user = userEvent.setup();
    const { unmount } = open();
    await user.click(screen.getByRole("button", { name: "Match" }));
    expect(router.push).toHaveBeenLastCalledWith("/applications?view=table&sort=match", { scroll: false });
    unmount();

    open({ sort: { key: "match", reversed: false } });
    expect(screen.getByRole("columnheader", { name: /Match/ })).toHaveAttribute("aria-sort", "descending");
    await user.click(screen.getByRole("button", { name: "Match" }));
    expect(router.push).toHaveBeenLastCalledWith("/applications?view=table&sort=-match", { scroll: false });
  });

  it("names A to Z ascending", () => {
    open({ sort: { key: "role", reversed: false } });
    expect(screen.getByRole("columnheader", { name: /Role/ })).toHaveAttribute("aria-sort", "ascending");
  });

  it("opens a row on click, but not from its status select", async () => {
    const user = userEvent.setup();
    open();
    const [kestrel] = screen.getAllByRole("row").slice(1);
    await user.selectOptions(within(kestrel).getByRole("combobox"), "INTERVIEW");
    expect(changeStatus).toHaveBeenCalledWith("kestrel", "INTERVIEW");
    expect(router.push).not.toHaveBeenCalled();

    await user.click(within(kestrel).getAllByRole("cell")[3]);
    expect(router.push).toHaveBeenCalledWith("/applications/kestrel");
    expect(within(kestrel).getByRole("link", { name: "Product Designer, Mobile" })).toHaveAttribute("href", "/applications/kestrel");
  });
});
