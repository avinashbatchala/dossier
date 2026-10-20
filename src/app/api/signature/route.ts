import { NextResponse } from "next/server";

import { route } from "@/lib/route";
import { SIGNATURE_MAX_BYTES, SIGNATURE_MESSAGES, isPng } from "@/lib/signature";
import { removeSignature, saveSignature } from "@/lib/signature-data";

/**
 * Uploads the PNG signature (E17) or removes it. A route handler rather than
 * a Server Action: the file is the request body, and the browser can send it
 * without base64-encoding it into JSON.
 */
export const POST = route(async (request) => {
  if (Number(request.headers.get("content-length") ?? 0) > SIGNATURE_MAX_BYTES) {
    return NextResponse.json({ error: SIGNATURE_MESSAGES.tooBig }, { status: 413 });
  }
  const type = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "image/png") return NextResponse.json({ error: SIGNATURE_MESSAGES.notPng }, { status: 415 });

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > SIGNATURE_MAX_BYTES) {
    return NextResponse.json({ error: SIGNATURE_MESSAGES.tooBig }, { status: 413 });
  }
  if (!isPng(bytes)) return NextResponse.json({ error: SIGNATURE_MESSAGES.notPng }, { status: 415 });

  await saveSignature(bytes);
  return NextResponse.json({ ok: true });
});

export const DELETE = route(async () => {
  await removeSignature();
  return NextResponse.json({ ok: true });
});
