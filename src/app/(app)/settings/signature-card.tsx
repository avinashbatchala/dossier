"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";

import { toast } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { SIGNATURE_MAX_BYTES, SIGNATURE_MESSAGES } from "@/lib/signature";

/** The PNG signature upload and the "sign new letters" default (E17). */
export function SignatureCard({
  signature,
  signCoverLetters,
  onDefaultChange,
}: {
  signature: string | null;
  signCoverLetters: boolean;
  onDefaultChange: (checked: boolean) => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState(signature);
  const [uploading, setUploading] = useState(false);

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.type !== "image/png") return void toast(SIGNATURE_MESSAGES.notPng);
    if (file.size > SIGNATURE_MAX_BYTES) return void toast(SIGNATURE_MESSAGES.tooBig);

    const before = preview;
    setPreview(await dataUrl(file));
    setUploading(true);
    try {
      const response = await fetch("/api/signature", { method: "POST", headers: { "content-type": "image/png" }, body: file });
      if (!response.ok) {
        const answer = (await response.json().catch(() => null)) as { error?: string } | null;
        toast(answer?.error ?? SIGNATURE_MESSAGES.notPng);
        setPreview(before);
        return;
      }
      toast("Signature saved. Sign a cover letter from its Cover letter tab.");
      router.refresh();
    } catch {
      toast("The signature couldn't be uploaded. Try again.");
      setPreview(before);
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    setUploading(true);
    try {
      const response = await fetch("/api/signature", { method: "DELETE" });
      if (!response.ok) {
        toast("The signature couldn't be removed. Try again.");
        return;
      }
      setPreview(null);
      toast("Signature removed. Cover letters will show the typed name only.");
      router.refresh();
    } catch {
      toast("The signature couldn't be removed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-serif text-[18px]">Signature</h3>
        <p className="text-sm text-pretty text-muted">
          Upload a PNG of your handwritten signature, ideally with a transparent background. It sits above your typed name on
          cover letters you choose to sign. It stays on your server.
        </p>
      </div>

      {preview ? (
        <div className="flex flex-wrap items-end gap-4 rounded-card border border-line-card bg-input px-4 py-3">
          {/* The signature is decorative here: its meaning is the name below it. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the database, not a remote asset */}
          <img src={preview} alt="" className="max-h-24 max-w-[260px] object-contain" />
          <span className="text-meta text-muted">Your signature</span>
        </div>
      ) : (
        <p className="rounded-card border border-dashed border-line-card px-4 py-5 text-sm text-muted">No signature uploaded yet.</p>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <label aria-disabled={uploading || undefined} className={buttonClassName("secondary", "sm", uploading ? "pointer-events-none opacity-60" : "cursor-pointer")}>
          {preview ? "Replace PNG" : "Upload PNG"}
          <input
            type="file"
            accept="image/png"
            disabled={uploading}
            className="sr-only"
            onChange={(event) => void choose(event)}
          />
        </label>
        {preview && (
          <Button variant="danger-text" size="sm" onClick={() => void remove()} disabled={uploading}>
            Remove
          </Button>
        )}
        <span className="text-meta text-muted">PNG, up to 500 KB</span>
      </div>

      <Checkbox
        label="Sign new cover letters with this signature"
        checked={signCoverLetters}
        onChange={(event) => onDefaultChange(event.target.checked)}
        hint="Each application still has a switch on its Cover letter tab, so you can sign or leave one unsigned."
      />
    </Card>
  );
}

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
