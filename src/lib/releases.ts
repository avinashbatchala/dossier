// Where Dossier's releases are published, for the update check and its
// notice (update-check.ts, the sidebar). Safe to use in the browser.

export const RELEASES_REPOSITORY = "AienTech/dossier";
/** How to update, in the README. */
export const UPGRADE_GUIDE_URL = `https://github.com/${RELEASES_REPOSITORY}#upgrading`;

/** A published release: its version, without the "v", and its page on GitHub. */
export type Release = { version: string; url: string };
