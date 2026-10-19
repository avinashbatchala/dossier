"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { toast } from "@/components/toast";

import { CALLBACK_MESSAGES } from "./google-section";

/** Says how connecting Google went, once, then tidies `?google=` out of the address. */
export function GoogleNotice({ outcome }: { outcome: string | null }) {
  const router = useRouter();
  useEffect(() => {
    if (!outcome) return;
    const message = CALLBACK_MESSAGES[outcome];
    if (message) toast(message);
    router.replace("/settings?section=google", { scroll: false });
  }, [outcome, router]);
  return null;
}
