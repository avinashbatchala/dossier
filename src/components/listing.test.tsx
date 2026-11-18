import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FilterChip, FilterChips, ListingRow, ListingTabs, PreviewFacts, PreviewReasons, SourceBar } from "./listing";

describe("the list pattern (E32-1)", () => {
  it("says where the list comes from, with its query as chips, a note and its actions", () => {
    render(<SourceBar label="Search" icon={<span>🔍</span>} chips={["Senior Product Designer", "Rotterdam + 25 km"]} note="Searched today 08:12 · 4 portals · 31 found" actions={<button>Search again</button>} />);
    const bar = within(screen.getByRole("region", { name: "Search" }));
    expect(bar.getAllByRole("listitem").map((chip) => chip.textContent)).toEqual(["Senior Product Designer", "Rotterdam + 25 km"]);
    expect(bar.getByText("Searched today 08:12 · 4 portals · 31 found")).toBeInTheDocument();
    expect(bar.getByRole("button", { name: "Search again" })).toBeInTheDocument();
  });

  it("shows tabs as links with their counts, the current one marked", () => {
    render(
      <ListingTabs
        label="Where they stand"
        current="saved"
        tabs={[
          { key: "open", label: "All open", count: 12, href: "/jobs" },
          { key: "saved", label: "Saved", count: 2, href: "/jobs?show=saved" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Saved 2" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "All open 12" })).not.toHaveAttribute("aria-current");
  });

  it("makes a filter chip open the app's menu, the choice ticked, filled once it's set (#519)", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FilterChips>
        <FilterChip label="Portal" value="" options={[{ value: "", label: "any" }, { value: "JSEARCH", label: "JSearch" }]} onChange={onChange} />
      </FilterChips>,
    );
    expect(screen.getByRole("group", { name: "Filters" })).toHaveTextContent("Portal: any");
    await userEvent.click(screen.getByRole("button", { name: "Portal: any" }));
    expect(screen.getByRole("menuitemradio", { name: "any" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("menuitemradio", { name: "JSearch" }));
    expect(onChange).toHaveBeenCalledWith("JSEARCH");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    rerender(<FilterChip label="Portal" value="JSEARCH" options={[{ value: "", label: "any" }, { value: "JSEARCH", label: "JSearch" }]} onChange={onChange} />);
    expect(screen.getByText("JSearch", { selector: "span" })).toHaveClass("font-medium");
  });

  it("marks the selected row", () => {
    render(<ListingRow title="Product Designer" sub="Ledgerly · Rotterdam" meta="2 days ago" selected onClick={() => {}} />);
    expect(screen.getByRole("button", { name: /Product Designer/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("lists facts and reasons, saying which way each reason goes", () => {
    render(
      <>
        <PreviewFacts facts={[{ label: "Apply by", value: "Thu 19 Nov", tone: "warning" }]} />
        <PreviewReasons reasons={[{ text: "Figma, at Fieldnote", good: true }, { text: "No payments work yet", good: false }]} />
      </>,
    );
    expect(screen.getByText("Apply by").nextSibling).toHaveTextContent("Thu 19 Nov");
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["✓In favour: Figma, at Fieldnote", "–Against: No payments work yet"]);
  });
});
