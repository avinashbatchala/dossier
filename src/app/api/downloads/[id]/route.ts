import { readFile, unlink } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { contentDisposition } from "@/lib/file-name";
import { getJob } from "@/lib/jobs/runner";
import { downloadsDir, zipPdfsJob } from "@/lib/jobs/zip-pdfs";
import { route } from "@/lib/route";

const GONE = "That download isn't here any more. Start a new one from Settings → Data and backups.";

/** Hands over a finished "Download all PDFs" zip (E10-5) once, then removes it from the server. */
export const GET = route<RouteContext<"/api/downloads/[id]">>(async (_request, { params }) => {
  const { id } = await params;
  const job = await getJob(id);
  const result = job?.type === zipPdfsJob.type && job.status === "DONE" ? zipPdfsJob.result.safeParse(job.result) : null;
  if (!result?.success) return NextResponse.json({ error: GONE }, { status: 404 });

  const file = path.join(downloadsDir(), result.data.file);
  const zip = await readFile(file).catch(() => null);
  if (!zip) return NextResponse.json({ error: GONE }, { status: 410 });
  await unlink(file).catch(() => {});
  return new Response(zip, {
    headers: { "content-type": "application/zip", "content-disposition": contentDisposition(result.data.fileName) },
  });
});
