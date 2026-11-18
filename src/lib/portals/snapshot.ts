// `yarn portals-snapshot`: the built-in portals' configs from the public
// dossier-portals repository (E23-1, S4a), which is their one source, into
// src/lib/portals/built-in/ for a release to bundle. Run it before a release;
// between releases, newer versions reach installs through the catalog.
import { writeFileSync } from "node:fs";

import { parsePortalConfig } from "./format";

const REPOSITORY = "AienTech/dossier-portals";
const BUILT_INS = ["jsearch", "adzuna", "freehire", "arbeitsagentur"];

async function snapshot() {
  for (const folder of BUILT_INS) {
    const url = `https://raw.githubusercontent.com/${REPOSITORY}/main/portals/${folder}/portal.json`;
    const response = await fetch(url, { headers: { "user-agent": "Dossier" } });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const text = await response.text();
    const parsed = parsePortalConfig(JSON.parse(text));
    if (!parsed.ok) throw new Error(`${folder}: ${parsed.problems.join("; ")}`);
    writeFileSync(`src/lib/portals/built-in/${folder}.json`, `${JSON.stringify(JSON.parse(text), null, 2)}\n`);
    console.log(`${parsed.config.name} ${parsed.config.version}`);
  }
}

void snapshot().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
