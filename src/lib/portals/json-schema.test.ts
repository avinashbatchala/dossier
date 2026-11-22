import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PORTAL_SCHEMA_FILE, portalJsonSchema } from "./json-schema";

describe("the portal config JSON Schema", () => {
  it("is what portal-config.schema.json holds (run `yarn portal-schema` after changing the format)", () => {
    expect(readFileSync(PORTAL_SCHEMA_FILE, "utf8")).toBe(portalJsonSchema());
  });

  it("refuses unknown fields, as the format does", () => {
    const schema = JSON.parse(portalJsonSchema()) as { additionalProperties?: boolean; required?: string[] };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining(["format", "id", "name", "hosts", "kind", "search", "test"]));
  });
});
