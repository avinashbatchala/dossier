// Puts what "On this computer" runs next to the packed app, in its resources
// folder. By hand, because electron-builder's extraResources quietly leaves out
// every node_modules folder. It comes from scripts/prepare-server.mjs, which has
// already checked it.

import { cpSync, existsSync } from "node:fs";
import path from "node:path";

const bundle = path.join(import.meta.dirname, "..", "build-server");

export default async function afterPack({ appOutDir }) {
  if (!existsSync(path.join(bundle, "server", "server.js"))) throw new Error("There's no server to pack. Run scripts/prepare-server.mjs first.");
  cpSync(bundle, path.join(appOutDir, "resources"), { recursive: true });
}
