import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RepositoryLink } from "./repository-link";
import { SidebarFrame } from "./sidebar-frame";

afterEach(() => {
  document.cookie = "dossier_sidebar=; max-age=0; path=/";
});

function renderLink(initialCollapsed = false) {
  render(
    <SidebarFrame initialCollapsed={initialCollapsed} brand={<span>Dossier</span>}>
      <RepositoryLink />
    </SidebarFrame>,
  );
  return screen.getByRole("link", { name: "Star on GitHub (opens in a new tab)" });
}

describe("RepositoryLink", () => {
  it("opens the repository in a new tab", () => {
    const link = renderLink();
    expect(link).toHaveAttribute("href", "https://github.com/AienTech/dossier");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).not.toHaveAttribute("title");
  });

  it("keeps its name and gets a tooltip while the sidebar is collapsed", () => {
    expect(renderLink(true)).toHaveAttribute("title", "Star on GitHub");
  });
});
