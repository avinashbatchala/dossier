// RSS and Atom feeds as plain objects (E22-1), so a feed portal's config reads
// them with the same paths as a JSON answer: "rss.channel.item.0.title",
// "feed.entry". Just enough XML for feeds: elements, attributes, text, CDATA,
// and the five predefined entities plus numeric ones. A DOCTYPE is skipped and
// its entities are never expanded, so a feed can't blow up in memory.
//
// An element with only text becomes that text. One with attributes or
// children becomes an object: attributes as "@name", children by name (a list
// when there are several), and its own text as "#text".

const MAX_DEPTH = 64;
const MAX_ELEMENTS = 50_000;

type Element = { name: string; attributes: Record<string, string>; children: [string, unknown][]; text: string[] };

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** Names that would reach an object's prototype; skipped. */
const UNSAFE_NAMES = new Set(["__proto__", "constructor", "prototype"]);

/** Text with its entities decoded; an unknown named entity stays as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z]{2,8});/g, (whole, entity: string) => {
    if (entity.startsWith("#")) {
      const code = entity[1] === "x" ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity] ?? whole;
  });
}

const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attributesOf(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1];
    if (UNSAFE_NAMES.has(name)) continue;
    attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function valueOf(element: Element): unknown {
  const text = element.text.join("").trim();
  const attributeNames = Object.keys(element.attributes);
  if (attributeNames.length === 0 && element.children.length === 0) return text;
  const byName = new Map<string, unknown[]>();
  for (const [name, value] of element.children) {
    if (UNSAFE_NAMES.has(name)) continue;
    byName.set(name, [...(byName.get(name) ?? []), value]);
  }
  const object: Record<string, unknown> = {};
  for (const name of attributeNames) object[`@${name}`] = element.attributes[name];
  for (const [name, values] of byName) object[name] = values.length === 1 ? values[0] : values;
  if (text) object["#text"] = text;
  return object;
}

const TOKEN = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^>]*?)?)(\/?)>|([^<]+)/gi;

/** A feed's XML as `{ rss: … }` or `{ feed: … }`, or null when it isn't XML with a root element. */
export function parseXml(xml: string): Record<string, unknown> | null {
  const root: Element = { name: "#root", attributes: {}, children: [], text: [] };
  const stack: Element[] = [root];
  let elements = 0;
  for (const match of xml.replace(/^﻿/, "").matchAll(TOKEN)) {
    const [, cdata, closing, opening, attributeText, selfClosing, text] = match;
    const current = stack.at(-1)!;
    if (cdata !== undefined) current.text.push(cdata);
    else if (text !== undefined) current.text.push(decodeEntities(text));
    else if (opening !== undefined) {
      if (++elements > MAX_ELEMENTS || stack.length > MAX_DEPTH) return null;
      const element: Element = { name: opening, attributes: attributesOf(attributeText ?? ""), children: [], text: [] };
      if (selfClosing) current.children.push([element.name, valueOf(element)]);
      else stack.push(element);
    } else if (closing !== undefined) {
      // A close tag without its opening one is skipped; one that skips others closes them too.
      const index = stack.findLastIndex((element) => element.name === closing);
      if (index <= 0) continue;
      while (stack.length > index) {
        const done = stack.pop()!;
        stack.at(-1)!.children.push([done.name, valueOf(done)]);
      }
    }
  }
  while (stack.length > 1) {
    const done = stack.pop()!;
    stack.at(-1)!.children.push([done.name, valueOf(done)]);
  }
  const top = root.children[0];
  return top ? { [top[0]]: top[1] } : null;
}
