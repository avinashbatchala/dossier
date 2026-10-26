"use client";

import { ScreenError, type ErrorPageProps } from "@/components/screen-error";

export default function StartupsError(props: ErrorPageProps) {
  return <ScreenError {...props} title="Startups didn't load" />;
}
