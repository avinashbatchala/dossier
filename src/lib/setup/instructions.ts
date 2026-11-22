/**
 * One numbered step in the setup guide (E21): what to do, in words with
 * **bold** for what's on the screen, and the page to do it on. Vendors'
 * labels come from their own docs, checked on 5 November 2026; when they
 * change, so do these.
 */
export type Instruction = { text: string; link?: { href: string; label: string } };

/** The wiki's pages for each part, which can be corrected between releases. */
export const WIKI = "https://github.com/AienTech/dossier/wiki";
