// robots.txt rules (RFC 9309), parsed and matched (#222). Pure functions:
// robots.ts fetches the file.

type Rule = { allow: boolean; pattern: string };
/** The rules for one product token: a list, or everything allowed ("all") or nothing ("none"). */
export type RobotsRules = Rule[] | "all" | "none";

/**
 * The rules in a robots.txt that apply to `token` ("dossier"): the groups
 * naming it, or else the "*" groups (RFC 9309 §2.2.1). Groups for the same
 * agent are merged.
 */
export function parseRobots(text: string, token: string): RobotsRules {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || (key !== "allow" && key !== "disallow")) continue;
    // An empty Disallow allows everything; it adds no rule.
    if (value) current.rules.push({ allow: key === "allow", pattern: value });
  }
  const own = groups.filter((group) => group.agents.includes(token.toLowerCase()));
  const chosen = own.length > 0 ? own : groups.filter((group) => group.agents.includes("*"));
  return chosen.flatMap((group) => group.rules);
}

/** A rule's path pattern as a regular expression: "*" is any text, a final "$" the path's end. */
function patternRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Whether `path` ("/careers?x=1") may be fetched: the longest matching rule wins, Allow on a tie (RFC 9309 §2.2.2). */
export function robotsAllow(rules: RobotsRules, path: string): boolean {
  if (rules === "all") return true;
  if (rules === "none") return false;
  if (path === "/robots.txt") return true;
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!patternRegex(rule.pattern).test(path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
  }
  return best?.allow ?? true;
}
