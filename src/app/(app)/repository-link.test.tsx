import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CoffeeLink, DiscordLink, RepositoryLink } from "./repository-link";
import { SidebarFrame } from "./sidebar-frame";

afterEach(() => {
  document.cookie = "dossier_sidebar=; max-age=0; path=/";
});

function renderLinks(initialCollapsed = false) {
  render(
    <SidebarFrame initialCollapsed={initialCollapsed} brand={<span>Dossier</span>}>
      <DiscordLink />
      <RepositoryLink />
      <CoffeeLink />
    </SidebarFrame>,
  );
  return {
    discord: screen.getByRole("link", { name: "Join us on Discord (opens in a new tab)" }),
    repository: screen.getByRole("link", { name: "Star on GitHub (opens in a new tab)" }),
    coffee: screen.getByRole("link", { name: "Buy me a coffee (opens in a new tab)" }),
  };
}

describe("DiscordLink, RepositoryLink and CoffeeLink", () => {
  it("open the Discord invite, the repository and the Buy Me a Coffee page in a new tab", () => {
    const { discord, repository, coffee } = renderLinks();
    expect(discord).toHaveAttribute("href", "https://discord.gg/4pfxADVSf9");
    expect(repository).toHaveAttribute("href", "https://github.com/AienTech/dossier");
    expect(coffee).toHaveAttribute("href", "https://buymeacoffee.com/aientech");
    for (const link of [discord, repository, coffee]) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).not.toHaveAttribute("title");
    }
  });

  it("keep their names and get a tooltip while the sidebar is collapsed", () => {
    const { discord, repository, coffee } = renderLinks(true);
    expect(discord).toHaveAttribute("title", "Join us on Discord");
    expect(repository).toHaveAttribute("title", "Star on GitHub");
    expect(coffee).toHaveAttribute("title", "Buy me a coffee");
  });
});
