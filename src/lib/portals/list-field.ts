// A list field's value (E23, #238): one entry a line, as the user typed or
// pasted them. An entry is a name such as a company's job board ("acme"), or
// a link to it, from which the name is taken: the `for` of an embedded board
// ("…/embed/job_board?for=acme") or the address's first part
// ("https://jobs.lever.co/acme").

const ENTRY = /^[A-Za-z0-9._-]{1,100}$/;

/** The name an entry stands for; "" when it isn't one. */
export function entryOf(line: string): string {
  const text = line.trim();
  if (!/^https?:\/\//i.test(text)) return ENTRY.test(text) ? text : "";
  try {
    const url = new URL(text);
    const name = url.searchParams.get("for") ?? url.pathname.split("/").find(Boolean) ?? "";
    return ENTRY.test(name) ? name : "";
  } catch {
    return "";
  }
}

/** A list field's entries, each once, at most `max`, and the lines that aren't one. */
export function listEntries(value: string, max: number): { entries: string[]; unread: string[] } {
  const entries: string[] = [];
  const unread: string[] = [];
  for (const line of value.split(/[\n,]/)) {
    if (!line.trim()) continue;
    const entry = entryOf(line);
    if (!entry) unread.push(line.trim());
    else if (!entries.includes(entry)) entries.push(entry);
  }
  return { entries: entries.slice(0, max), unread };
}
