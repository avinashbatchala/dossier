import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Breadcrumb } from "./breadcrumb";

vi.mock("next/link", () => ({ default: (props: React.ComponentProps<"a">) => <a {...props} /> }));

describe("Breadcrumb (#514)", () => {
  it("links the parents, ends with the page itself, and hides the separators", () => {
    render(<Breadcrumb items={[{ label: "Settings", href: "/settings" }, { label: "AI provider" }]} />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    const items = within(nav).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["Settings", "/AI provider"]);
    expect(within(items[0]).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(items[1]).toHaveAttribute("aria-current", "page");
    expect(within(items[1]).queryByRole("link")).not.toBeInTheDocument();
    expect(within(items[1]).getByText("/")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps a page whose heading shows it for screen readers only, with what follows a parent", () => {
    render(
      <Breadcrumb
        items={[
          { label: "Applications", href: "/applications" },
          { label: "Interview", href: "/applications?status=interview", extra: " · tomorrow" },
          { label: "Designer at Ledgerly", hidden: true },
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items[1]).toHaveTextContent("/Interview · tomorrow");
    expect(within(items[1]).getByRole("link", { name: "Interview" })).toHaveAttribute("href", "/applications?status=interview");
    expect(items[2]).toHaveClass("sr-only");
    expect(items[2]).toHaveAttribute("aria-current", "page");
    expect(items[2]).toHaveTextContent(/^Designer at Ledgerly$/);
  });
});
