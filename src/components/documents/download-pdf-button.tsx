"use client";

import { useState, type ReactNode } from "react";

import { toast } from "@/components/toast";
import { cn } from "@/lib/cn";
import { buttonClassName, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { messages } from "@/lib/messages";
import { downloadFrom, saveFile } from "@/lib/save-file";

/** The file name a download response asks for, preferring the UTF-8 one (RFC 6266). */
export function fileNameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall back to the plain name.
    }
  }
  return /filename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
}

/**
 * Downloads a PDF from /api/pdf. Rendering takes a moment, so it says so,
 * and a failure shows up as a toast instead of an error page. Without
 * JavaScript it's a plain link to the same file.
 */
export function DownloadPdfButton({
  href,
  held = true,
  variant = "primary",
  size = "md",
  progress = "Rendering your PDF on the server. It'll download in a moment.",
  className,
  children,
}: {
  href: string;
  /**
   * Whether `href` answers a POST by holding the file on the server and
   * sending the link to download it from, as /api/pdf does. Browsers save
   * that reliably; otherwise the file is fetched and saved from the page.
   */
  held?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** The toast while it renders, e.g. "Rendering your cover letter as a PDF…". */
  progress?: string;
  className?: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    toast(progress);
    try {
      const response = await fetch(href, held ? { method: "POST" } : undefined);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        toast(body?.error ?? messages.unexpected);
        return;
      }
      if (held) {
        const { url } = (await response.json()) as { url: string };
        downloadFrom(url);
      } else {
        saveFile(await response.blob(), fileNameFrom(response.headers.get("content-disposition")) ?? "document.pdf");
      }
    } catch {
      toast(messages.offline);
    } finally {
      setBusy(false);
    }
  };

  return (
    <a
      href={href}
      aria-disabled={busy || undefined}
      onClick={(event) => {
        event.preventDefault();
        if (!busy) void download();
      }}
      className={buttonClassName(variant, size, cn(variant === "primary" && "hover:text-on-primary", className))}
    >
      {busy ? "Rendering…" : children}
    </a>
  );
}
