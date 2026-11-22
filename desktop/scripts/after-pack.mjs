// Puts what "On this computer" runs next to the packed app, in its resources
// folder. By hand, because electron-builder's extraResources quietly leaves out
// every node_modules folder. It comes from scripts/prepare-server.mjs, which has
// already checked it.

import { cpSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const bundle = path.join(import.meta.dirname, "..", "build-server");

export default async function afterPack({ appOutDir, electronPlatformName }) {
  if (!existsSync(path.join(bundle, "server", "server.js"))) throw new Error("There's no server to pack. Run scripts/prepare-server.mjs first.");
  // A Mac app keeps its resources inside the bundle; Linux and Windows have an
  // unpacked folder with a resources folder beside the executable.
  const resources =
    electronPlatformName === "darwin" ? path.join(appOutDir, `${productName()}.app`, "Contents", "Resources") : path.join(appOutDir, "resources");
  cpSync(bundle, resources, { recursive: true });
}

/** The packed app's name, from electron-builder's configuration. */
function productName() {
  const config = readFileSync(path.join(import.meta.dirname, "..", "electron-builder.yml"), "utf8");
  return /^productName:\s*(.+)$/m.exec(config)?.[1].trim() ?? "Dossier";
}
