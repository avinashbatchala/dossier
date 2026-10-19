import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NavLinks } from "./nav-links";
import { SidebarFrame } from "./sidebar-frame";
import { ThemeToggle } from "./theme-toggle";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/link", () => ({
  default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} />,
}));

let systemDark = false;
beforeEach(() => {
  systemDark = false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("dark") && systemDark,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
  document.cookie = "dossier_theme=; max-age=0; path=/";
  document.cookie = "dossier_sidebar=; max-age=0; path=/";
});

function renderSidebar(initialCollapsed = false) {
  return render(
    <SidebarFrame initialCollapsed={initialCollapsed} brand={<span>Dossier</span>}>
      <NavLinks />
      <ThemeToggle />
    </SidebarFrame>,
  );
}

describe("SidebarFrame", () => {
  it("collapses to icons, keeps every link named, and remembers it", async () => {
    renderSidebar();
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(screen.getByRole("complementary")).toHaveAttribute("data-collapsed", "true");
    // The labels are only visually hidden, so links keep their names.
    expect(screen.getByRole("link", { name: "Applications" })).toHaveAttribute("title", "Applications");
    expect(document.cookie).toContain("dossier_sidebar=collapsed");

    await userEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByRole("complementary")).not.toHaveAttribute("data-collapsed");
    expect(document.cookie).toContain("dossier_sidebar=expanded");
  });

  it("starts collapsed when it was left that way", () => {
    renderSidebar(true);
    expect(screen.getByRole("complementary")).toHaveAttribute("data-collapsed", "true");
  });
});

describe("ThemeToggle", () => {
  it("offers the other scheme to the system's, then switches and remembers", async () => {
    renderSidebar();
    await userEvent.click(screen.getByRole("button", { name: "Dark mode" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.cookie).toContain("dossier_theme=dark");
    await userEvent.click(screen.getByRole("button", { name: "Light mode" }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("follows a dark system until a choice is made", () => {
    systemDark = true;
    renderSidebar();
    expect(screen.getByRole("button", { name: "Light mode" })).toBeInTheDocument();
  });
});
