import { z } from "zod";

import { portalConfigSchema } from "./format";

// The portal config format as JSON Schema (E22-1), for checking configs where
// zod doesn't run, such as the public config repository's pull requests.
// Written by `yarn portal-schema`; a test fails when it's out of date. The
// checks across fields (hosts, template names) are only in parsePortalConfig.

export const PORTAL_SCHEMA_FILE = "src/lib/portals/portal-config.schema.json";

export function portalJsonSchema(): string {
  const schema = z.toJSONSchema(portalConfigSchema, { io: "input", unrepresentable: "any" });
  return `${JSON.stringify({ ...schema, title: "Dossier portal config" }, null, 2)}\n`;
}
