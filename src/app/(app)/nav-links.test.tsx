import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { sidebarStatuses } from "@/lib/applications-list";

import { NavLinks, type ApplicationsNav } from "./nav-links";

let pathname = "/";
let search = "";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useSearchParams: () => new URLSearchParams(search) }));
vi.mock("next/link", () => ({
  default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} />,
}));

function currentItem(path: string) {
  pathname = path;
  const { unmount } = render(<NavLinks />);
  const current = screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent);
  unmount();
  return current;
}

describe("NavLinks", () => {
  it("lists the sections in the refresh's groups (E27-3)", () => {
    render(<NavLinks />);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Dashboard",
      "Applications",
      "Inbox",
      "Positions",
      "Startups",
      "Agent",
      "Profile",
      "Base resume",
      "Usage",
      "Settings",
    ]);
    expect(screen.getByText("Track")).toBeInTheDocument();
    expect(screen.getByText("Find work")).toBeInTheDocument();
  });

  it("marks exactly one current section", () => {
    expect(currentItem("/")).toEqual(["Dashboard"]);
    expect(currentItem("/profile")).toEqual(["Profile"]);
    expect(currentItem("/resume")).toEqual(["Base resume"]);
    expect(currentItem("/jobs")).toEqual(["Positions"]);
    expect(currentItem("/startups")).toEqual(["Startups"]);
    expect(currentItem("/usage")).toEqual(["Usage"]);
    expect(currentItem("/settings")).toEqual(["Settings"]);
  });

  it("keeps Applications current on an application and in the new application flow", () => {
    expect(currentItem("/applications")).toEqual(["Applications"]);
    expect(currentItem("/applications/abc123")).toEqual(["Applications"]);
    expect(currentItem("/new")).toEqual(["Applications"]);
  });

  it("sets the current section apart from a hovered one, by more than colour", () => {
    pathname = "/profile";
    render(<NavLinks />);
    expect(screen.getByRole("link", { name: "Profile" })).toHaveClass("bg-nav-active", "shadow-raised", "font-medium");
    expect(screen.getByRole("link", { name: "Settings" })).not.toHaveClass("font-medium");
  });

  it("doesn't treat a path that only starts with the same letters as a match", () => {
    expect(currentItem("/profiles")).toEqual([]);
    expect(currentItem("/newsletter")).toEqual([]);
  });

  describe("statuses under Applications (E27-4)", () => {
    const applications = (open = true): ApplicationsNav => ({
      total: 9,
      statuses: sidebarStatuses(new Map([["DRAFT", 2], ["SENT", 2], ["SCREENING", 1], ["INTERVIEW", 1], ["OFFER", 1], ["REJECTED", 1], ["DECLINED", 1]] as const)),
      open,
    });

    it("lists each status with its count and link, Closed last", () => {
      pathname = "/";
      search = "";
      render(<NavLinks applications={applications()} />);
      expect(screen.getByRole("link", { name: /^Applications/ })).toHaveTextContent("9");
      const list = screen.getByRole("list", { name: "Applications by status" });
      expect(within(list).getAllByRole("link").map((link) => link.textContent)).toEqual(["Draft2", "Sent2", "Screening1", "Interview1", "Offer1", "Closed2"]);
      expect(within(list).getByRole("link", { name: /Sent/ })).toHaveAttribute("href", "/applications?status=sent");
    });

    it("marks the open status current, and sets Applications in ink instead of the chip", () => {
      pathname = "/applications";
      search = "status=sent&view=list";
      render(<NavLinks applications={applications()} />);
      const list = screen.getByRole("list", { name: "Applications by status" });
      expect(within(list).getByRole("link", { name: /Sent/ })).toHaveAttribute("aria-current", "page");
      const parent = screen.getByRole("link", { name: /^Applications/ });
      expect(parent).not.toHaveAttribute("aria-current");
      expect(parent).toHaveClass("font-medium", "text-ink");
      expect(parent).not.toHaveClass("bg-nav-active");
    });

    it("keeps Applications current on the plain list", () => {
      pathname = "/applications";
      search = "";
      render(<NavLinks applications={applications()} />);
      expect(screen.getByRole("link", { name: /^Applications/ })).toHaveAttribute("aria-current", "page");
    });

    it("hides and shows the statuses, and remembers it", async () => {
      pathname = "/";
      search = "";
      render(<NavLinks applications={applications(false)} />);
      expect(screen.queryByRole("list", { name: "Applications by status" })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Show statuses" }));
      expect(screen.getByRole("list", { name: "Applications by status" })).toBeInTheDocument();
      expect(document.cookie).toContain("dossier_sidebar_statuses=open");
      await userEvent.click(screen.getByRole("button", { name: "Hide statuses" }));
      expect(document.cookie).toContain("dossier_sidebar_statuses=closed");
    });
  });
});
