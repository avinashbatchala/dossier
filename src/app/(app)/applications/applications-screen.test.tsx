import { act, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApplicationRow } from "@/lib/applications-data";
import { DEFAULT_SORT, type ListParams, sidebarStatuses } from "@/lib/applications-list";

import { applicationRow } from "@/test/application-row";

import { rememberListView } from "./actions";
import { ApplicationsScreen, type ApplicationsScreenProps } from "./applications-screen";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("./actions", () => ({ rememberListView: vi.fn(async () => ({ ok: true, data: null })), reorderBoard: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => null }));
vi.mock("next/link", () => ({ default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} /> }));

export const row = (id: string, extra: Partial<ApplicationRow> = {}): ApplicationRow => applicationRow(id, extra);

const params: ListParams = { view: "board", status: null, q: "", sort: DEFAULT_SORT, archived: false };
const props: ApplicationsScreenProps = {
  params,
  rows: [row("a1"), row("a2", { company: "Oaken Studio", status: "OFFER" })],
  tabs: { all: 2, statuses: sidebarStatuses(new Map([["SENT", 1], ["OFFER", 1]])) },
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
  it("has the summary and the views, and leaves New application to the sidebar (E27-7)", () => {
    render(<ApplicationsScreen {...props} />);
    expect(screen.getByRole("heading", { level: 1, name: "Applications" })).toBeInTheDocument();
    expect(screen.getByText(props.summary)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Board" })).toBeChecked();
    expect(screen.queryByRole("link", { name: "+ New application" })).not.toBeInTheDocument();
    expect(screen.getByText("Drag a card to change its status")).toBeInTheDocument();
  });

  it("has a tab for each status, with its count, as the sidebar has them (E29-1)", () => {
    render(<ApplicationsScreen {...props} params={{ ...params, view: "list", q: "led" }} />);
    const tabs = screen.getByRole("navigation", { name: "Statuses" });
    expect(within(tabs).getAllByRole("link").map((tab) => tab.textContent)).toEqual(["All2", "Draft0", "Sent1", "Screening0", "Interview0", "Offer1", "Closed0"]);
    expect(within(tabs).getByRole("link", { name: /^All/ })).toHaveAttribute("aria-current", "page");
    // A status opens as a list, keeping the search.
    expect(within(tabs).getByRole("link", { name: /^Sent/ })).toHaveAttribute("href", "/applications?status=sent&view=list&q=led");
  });

  it("titles a status with its dot and says what stands out in it (E29-1)", () => {
    render(<ApplicationsScreen {...props} params={{ ...params, status: "SENT", view: "list" }} summary="1 waiting to hear back." />);
    expect(screen.getByRole("heading", { level: 1, name: "Sent" })).toBeInTheDocument();
    expect(screen.getByText("1 waiting to hear back.")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Statuses" })).getByRole("link", { name: /^Sent/ })).toHaveAttribute("aria-current", "page");
  });

  it("switches to the list", async () => {
    const user = userEvent.setup();
    render(<ApplicationsScreen {...props} />);
    await user.click(screen.getByRole("radio", { name: "List" }));
    expect(router.push).toHaveBeenCalledWith("/applications?view=list", { scroll: false });
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
    rerender(<ApplicationsScreen {...props} rows={[]} params={{ ...params, status: "closed" }} />);
    expect(screen.getByText("Nothing in this view yet.")).toBeInTheDocument();
  });

  it("points a new user to their first application", () => {
    render(<ApplicationsScreen {...props} rows={[]} tabs={{ all: 0, statuses: sidebarStatuses(new Map()) }} empty />);
    expect(screen.getByRole("heading", { name: "Your first application" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fill in your profile" })).toHaveAttribute("href", "/profile");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("remembers the view for next time, per status when one is on show (E9-4, LB1)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ApplicationsScreen {...props} />);
    await user.click(screen.getByRole("radio", { name: "List" }));
    expect(rememberListView).toHaveBeenCalledWith({ view: "list", status: null, sort: DEFAULT_SORT });
    rerender(<ApplicationsScreen {...props} params={{ ...params, status: "SENT", view: "list" }} />);
    await user.click(screen.getByRole("radio", { name: "Board" }));
    expect(rememberListView).toHaveBeenLastCalledWith({ view: "board", status: "SENT", sort: DEFAULT_SORT });
    expect(router.push).toHaveBeenLastCalledWith("/applications?status=sent&view=board", { scroll: false });
  });

  it("doesn't remember searches", async () => {
    const user = userEvent.setup();
    render(<ApplicationsScreen {...props} />);
    await user.type(screen.getByRole("searchbox"), "ledg{Enter}");
    expect(router.replace).toHaveBeenCalledWith("/applications?q=ledg", { scroll: false });
    expect(rememberListView).not.toHaveBeenCalled();
  });
});
