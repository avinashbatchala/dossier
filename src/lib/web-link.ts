const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;
/** A web address as people write one: a host with a dot and a top-level domain, maybe a path. A city or a phone number isn't one. */
const WEB_ADDRESS = /^(?:https?:\/\/)?(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}(?:[/?#]\S*)?$/iu;

/**
 * What a contact detail opens on a document (#369): an email address writes
 * to it, a web address opens it; anything else (a phone number, a place, an
 * age) stays text.
 */
export function contactHref(item: string): string | null {
  const value = item.trim();
  if (EMAIL.test(value)) return `mailto:${value}`;
  return WEB_ADDRESS.test(value) ? webHref(value) : null;
}

/** The link a resume can open: http(s) only, with "https://" added when it's missing; null for anything else. */
export function webHref(link: string): string | null {
  const value = link.trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
