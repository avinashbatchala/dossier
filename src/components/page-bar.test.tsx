import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PageHeader } from "./page-header";

vi.mock("next/navigation", () => ({ usePathname: () => "/jobs" }));

describe("PageHeader", () => {
  it("puts the title and actions in the bar, with the section's icon, and the description under it", () => {
    const { container } = render(
      <PageHeader title="Find jobs" description="Search for postings." actions={<button type="button">Search</button>} />,
    );
    const title = screen.getByRole("heading", { level: 1, name: "Find jobs" });
    const bar = title.closest(".sticky")!;
    expect(bar).toContainElement(screen.getByRole("button", { name: "Search" }));
    expect(bar.querySelector("svg")).not.toBeNull();
    expect(bar).not.toHaveTextContent("Search for postings.");
    expect(container).toHaveTextContent("Search for postings.");
  });
});
