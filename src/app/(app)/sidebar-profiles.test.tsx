import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProfiles, type ProfilesNav } from "./sidebar-profiles";

let pathname = "/";
let search = "";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} />,
}));
vi.mock("./profile/profiles-actions", () => ({ newProfile: vi.fn(), renameProfileAction: vi.fn(), deleteProfileAction: vi.fn() }));

const nav = (extra: Partial<ProfilesNav> = {}): ProfilesNav => ({
  profiles: [
    { id: "p1", name: "Product design", strength: 92 },
    { id: "p2", name: "Service design", strength: 40 },
  ],
  openId: "p1",
  expanded: true,
  ...extra,
});

beforeEach(() => {
  pathname = "/";
  search = "";
});

describe("SidebarProfiles (E27-5)", () => {
  it("lists each profile, the first marked Default, with the open one's Profile and Base resume", () => {
    render(<SidebarProfiles {...nav()} />);
    const list = screen.getByRole("list", { name: "Your profiles" });
    expect(within(list).getByRole("link", { name: /Product design/ })).toHaveTextContent("Default");
    expect(within(list).getByRole("link", { name: /Service design/ })).toHaveAttribute("href", "/profile?profile=p2");
    const pages = screen.getByRole("list", { name: "Product design's pages" });
    expect(within(pages).getByRole("link", { name: /^Profile/ })).toHaveAttribute("href", "/profile?profile=p1");
    expect(within(pages).getByRole("link", { name: "Base resume" })).toHaveAttribute("href", "/resume?profile=p1");
    expect(within(pages).getByRole("img", { name: "92% complete" })).toBeInTheDocument();
  });

  it("follows the profile the page opened, and marks the page", () => {
    pathname = "/resume";
    search = "profile=p2";
    render(<SidebarProfiles {...nav()} />);
    const pages = screen.getByRole("list", { name: "Service design's pages" });
    expect(within(pages).getByRole("link", { name: "Base resume" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("list", { name: "Product design's pages" })).not.toBeInTheDocument();
  });

  it("folds the open profile's pages, and remembers it", async () => {
    pathname = "/profile";
    render(<SidebarProfiles {...nav()} />);
    await userEvent.click(screen.getByRole("button", { name: "Hide Product design's pages" }));
    expect(screen.queryByRole("list", { name: "Product design's pages" })).not.toBeInTheDocument();
    expect(document.cookie).toContain("dossier_sidebar_profiles=closed");
    // Folded, the profile itself is the current item.
    expect(screen.getByRole("link", { name: /Product design/ })).toHaveAttribute("aria-current", "page");
  });

  it("doesn't mark a single profile as the default", () => {
    render(<SidebarProfiles {...nav({ profiles: [{ id: "p1", name: "Product design", strength: 92 }] })} />);
    expect(screen.getByRole("link", { name: /Product design/ })).not.toHaveTextContent("Default");
  });

  it("opens the New profile dialog from +", async () => {
    render(<SidebarProfiles {...nav()} />);
    await userEvent.click(screen.getByRole("button", { name: "New profile" }));
    expect(screen.getByRole("dialog", { name: "New profile" })).toBeInTheDocument();
  });
});
