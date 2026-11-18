import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jumpSearch } from "./actions";
import { JumpTo } from "./jump-to";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./actions", () => ({ jumpSearch: vi.fn() }));

const groups = [
  { label: "Screens", results: [{ id: "screen:/", label: "Dashboard", href: "/" }] },
  {
    label: "Applications",
    results: [
      { id: "application:a", label: "Designer at Ledgerly", detail: "Sent", href: "/applications/a" },
      { id: "application:b", label: "Engineer at Northwind", detail: "Draft · Archived", href: "/applications/b" },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(jumpSearch).mockResolvedValue({ ok: true, data: groups });
});

describe("JumpTo (E27-6)", () => {
  it("opens from the field, lists the results by group, and opens one with the keyboard", async () => {
    render(<JumpTo />);
    await userEvent.click(screen.getByRole("button", { name: /Jump to/ }));
    const input = screen.getByRole("combobox", { name: "Jump to" });
    expect(input).toHaveFocus();
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
    expect(screen.getByRole("group", { name: "Applications" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[2].id);
    await userEvent.keyboard("{Enter}");
    expect(router.push).toHaveBeenCalledWith("/applications/b");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("opens with Ctrl+K or ⌘K anywhere, searches as you type, and gives focus back on Esc", async () => {
    render(
      <>
        <button type="button">Elsewhere</button>
        <JumpTo />
      </>,
    );
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("combobox", { name: "Jump to" })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("combobox"), "ledg");
    await waitFor(() => expect(jumpSearch).toHaveBeenLastCalledWith({ q: "ledg" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();

    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByRole("combobox", { name: "Jump to" })).toBeInTheDocument();
  });

  it("opens the first result for what's typed when Enter comes before the results", async () => {
    render(<JumpTo />);
    await userEvent.click(screen.getByRole("button", { name: /Jump to/ }));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
    vi.mocked(jumpSearch).mockResolvedValue({ ok: true, data: [{ label: "Applications", results: [{ id: "application:c", label: "Lead at Ledgerly", href: "/applications/c" }] }] });
    // Typed and sent at once, inside the pause before a search.
    await userEvent.type(screen.getByRole("combobox"), "ledg{Enter}", { delay: null });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/applications/c"));
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("says when nothing matches", async () => {
    vi.mocked(jumpSearch).mockResolvedValue({ ok: true, data: [] });
    render(<JumpTo />);
    await userEvent.click(screen.getByRole("button", { name: /Jump to/ }));
    await userEvent.type(screen.getByRole("combobox"), "zzz");
    expect(await screen.findByText("Nothing matches “zzz”.")).toBeInTheDocument();
  });
});
