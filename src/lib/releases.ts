// Where Dossier's releases are published, for the update check and its
// notice (update-check.ts, the sidebar). Safe to use in the browser.

export const RELEASES_REPOSITORY = "AienTech/dossier";
/** The repository's page, for credits and support (the sidebar). */
export const REPOSITORY_URL = `https://github.com/${RELEASES_REPOSITORY}`;
/** The maintainer's Buy Me a Coffee page, for donations (the sidebar). */
export const COFFEE_URL = "https://buymeacoffee.com/aientech";
/** The invite to Dossier's Discord server, where job seekers help each other (the sidebar). */
export const DISCORD_URL = "https://discord.gg/4pfxADVSf9";
/** How to update, in the wiki. */
export const UPGRADE_GUIDE_URL = `${REPOSITORY_URL}/wiki/Upgrading`;

/** A published release: its version, without the "v", and its page on GitHub. */
export type Release = { version: string; url: string };

/** 1.10.0 is newer than 1.9.2; anything after "-" (a pre-release) is ignored. */
export function isNewer(candidate: string, current: string): boolean {
  const parts = (version: string) => version.replace(/^v/i, "").split("-")[0].split(".").map((part) => Number(part) || 0);
  const [a, b] = [parts(candidate), parts(current)];
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}
