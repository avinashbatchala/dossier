// `yarn portal-schema`: writes the portal config format's JSON Schema.
import { writeFileSync } from "node:fs";

import { PORTAL_SCHEMA_FILE, portalJsonSchema } from "./json-schema";

writeFileSync(PORTAL_SCHEMA_FILE, portalJsonSchema());
console.log(`Wrote ${PORTAL_SCHEMA_FILE}.`);
