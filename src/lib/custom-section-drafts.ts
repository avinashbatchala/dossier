import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { DocumentKind } from "@/generated/prisma/enums";
import { trimmedSchema, unitsSchema } from "@/lib/application-data";
import { customSectionUnitIds, customSectionUnits } from "@/lib/custom-section-units";
import { updateDocuments } from "@/lib/document-units";
import { prisma } from "@/lib/prisma";
import { resumeCustomSections, type CustomSection } from "@/lib/profile";

/**
 * A custom section's format changed (#298): resumes not sent yet that hold it
 * get its parts again in the new format, since each format keeps other text
 * in them. Sent resumes keep what was sent, so they aren't touched.
 */
export async function rewriteSectionOnDrafts(section: CustomSection): Promise<void> {
  const ids = new Set(customSectionUnitIds(section));
  const parts = resumeCustomSections([section]).flatMap(customSectionUnits);
  const rows = await prisma.document.findMany({
    where: { kind: DocumentKind.RESUME, application: { sentAt: null } },
    select: { id: true, applicationId: true, units: true, trimmed: true },
  });

  for (const row of rows) {
    const held = unitsSchema.safeParse(row.units);
    if (held.success && held.data.some((unit) => ids.has(unit.id))) {
      await updateDocuments(row.applicationId, async (documents) => {
        const units = documents[DocumentKind.RESUME];
        const at = units?.findIndex((unit) => ids.has(unit.id)) ?? -1;
        if (!units || at < 0) return;
        const rest = units.filter((unit) => !ids.has(unit.id));
        rest.splice(at, 0, ...parts);
        documents[DocumentKind.RESUME] = rest;
      });
    }
    // What was left out of it no longer fits it. Written after the document itself: updateDocuments checks it wasn't changed meanwhile.
    const trimmed = trimmedSchema.safeParse(row.trimmed);
    if (trimmed.success) {
      const rest = trimmed.data.filter((cut) => !(cut.kind === "unit" ? ids.has(cut.unit.id) : ids.has(cut.unitId)));
      if (rest.length !== trimmed.data.length) {
        await prisma.document.update({ where: { id: row.id }, data: { trimmed: rest.length > 0 ? rest : Prisma.DbNull } });
      }
    }
  }
}
