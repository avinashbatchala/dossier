import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApplicationRow } from "@/lib/applications-data";
import { DEFAULT_SORT, type ListParams } from "@/lib/applications-list";

import { rememberListView } from "./actions";
import { ApplicationsScreen, type ApplicationsScreenProps } from "./applications-screen";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("./actions", () => ({ rememberListView: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => null }));

export const row = (id: string, extra: Partial<ApplicationRow> = {}): ApplicationRow => ({
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

const params: ListParams = { view: "board", filter: "all", q: "", sort: DEFAULT_SORT, archived: false };
const props: ApplicationsScreenProps = {
  params,
  rows: [row("a1"), row("a2", { company: "Oaken Studio", status: "OFFER" })],
  counts: { all: 2, active: 2, closed: 0 },
  summary: "2 applications: 1 waiting to hear back, 1 in conversation. Nice momentum.",
  empty: false,
  archivedCount: 0,
};

beforeEach(() => {
  router.push.mockClear();
  router.replace.mockClear();
  vi.mocked(rememberListView).mockClear();
});

describe("the Applications screen (E9-1)", () => {
  it("has the summary, the views and a way to start a new application", () => {
    render(<ApplicationsScreen {...props} />);
    expect(screen.getByRole("heading", { level: 1, name: "Applications" })).toBeInTheDocument();
    expect(screen.getByText(props.summary)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Board" })).toBeChecked();
    expect(screen.getByRole("link", { name: "+ New application" })).toHaveAttribute("href", "/new?fresh=1");
    expect(screen.getByText("Drag a card to change its status")).toBeInTheDocument();
  });

  it("filters with counts, through the URL", async () => {
    const user = userEvent.setup();
    render(<ApplicationsScreen {...props} />);
    expect(screen.getByRole("button", { name: "All 2" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Closed 0" }));
    expect(router.push).toHaveBeenCalledWith("/applications?filter=closed", { scroll: false });
  });

  it("switches to the table", async () => {
    const user = userEvent.setup();
    render(<ApplicationsScreen {...props} />);
    await user.click(screen.getByRole("radio", { name: "Table" }));
    expect(router.push).toHaveBeenCalledWith("/applications?view=table", { scroll: false });
  });

  it("searches once typing pauses, without piling up history", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<ApplicationsScreen {...props} />);
      await user.type(screen.getByRole("searchbox", { name: "Search applications" }), "ledg");
      expect(router.replace).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(300));
      expect(router.replace).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledWith("/applications?q=ledg", { scroll: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows the URL's search, e.g. after Back", () => {
    const { rerender } = render(<ApplicationsScreen {...props} params={{ ...params, q: "oaken" }} />);
    expect(screen.getByRole("searchbox")).toHaveValue("oaken");
    rerender(<ApplicationsScreen {...props} params={{ ...params, q: "" }} />);
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("says when a search or a filter finds nothing", () => {
    const { rerender } = render(<ApplicationsScreen {...props} rows={[]} params={{ ...params, q: "zzz" }} />);
    expect(screen.getByText("No applications match “zzz”.")).toBeInTheDocument();
    rerender(<ApplicationsScreen {...props} rows={[]} params={{ ...params, filter: "closed" }} />);
    expect(screen.getByText("Nothing in this view yet.")).toBeInTheDocument();
  });

  it("points a new user to their first application", () => {
    render(<ApplicationsScreen {...props} rows={[]} counts={{ all: 0, active: 0, closed: 0 }} empty />);
    expect(screen.getByRole("heading", { name: "Your first application" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fill in your profile" })).toHaveAttribute("href", "/profile");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("remembers the view, filter and sort for next time (E9-4)", async () => {
    const user = userEvent.setup();
    render(<ApplicationsScreen {...props} />);
    await user.click(screen.getByRole("button", { name: "Closed 0" }));
    expect(rememberListView).toHaveBeenCalledWith({ view: "board", filter: "closed", sort: DEFAULT_SORT });
  });

  it("doesn't remember searches", async () => {
    const user = userEvent.setup();
    render(<ApplicationsScreen {...props} />);
    await user.type(screen.getByRole("searchbox"), "ledg{Enter}");
    expect(router.replace).toHaveBeenCalledWith("/applications?q=ledg", { scroll: false });
    expect(rememberListView).not.toHaveBeenCalled();
  });
});
