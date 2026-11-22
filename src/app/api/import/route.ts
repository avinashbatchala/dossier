import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { JobStatus } from "@/generated/prisma/enums";
import { writeBackup } from "@/lib/backups";
import { currentSummary, importExport, parseExport, summarizeExport } from "@/lib/data-import";
import { freezeSentApplications } from "@/lib/frozen-copy";
import { IMPORT_MAX_BYTES, IMPORT_TOO_BIG } from "@/lib/import-limits";
import { cancelJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/route";

/**
 * Restores from an export file (E10-6, SET-10), sent as the request body.
 * A route handler rather than a Server Action, whose body limit is 1 MB;
 * the proxy still caps bodies at 10 MB (see DEVELOPMENT.md). `?preview=1` only reads
 * the file and says what it would replace. Otherwise the current data is
 * backed up to DOSSIER_DATA_DIR/backups first, then replaced in one go.
 */
export const POST = route(async (request) => {
  // Past the proxy's limit a body arrives cut off, so refuse it up front.
  if (Number(request.headers.get("content-length") ?? 0) > IMPORT_MAX_BYTES) {
    return NextResponse.json({ error: IMPORT_TOO_BIG }, { status: 413 });
  }
  const parsed = parseExport(await request.text());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const incoming = summarizeExport(parsed.data);

  if (request.nextUrl.searchParams.get("preview") === "1") {
    return NextResponse.json({ incoming, current: await currentSummary(prisma), exportedAt: parsed.data.exportedAt });
  }

  // Work in progress would write into data that's about to be replaced.
  const unfinished = await prisma.job.findMany({ where: { status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } }, select: { id: true } });
  for (const job of unfinished) await cancelJob(job.id);

  const backup = await writeBackup("before-import");
  await importExport(prisma, parsed.data);
  // A file from before 1.12 has no copies of what its sent applications were sent with (#299).
  await freezeSentApplications();
  revalidatePath("/", "layout");
  return NextResponse.json({ incoming, backup });
});
