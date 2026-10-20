"use client";

import { ScreenError, type ErrorPageProps } from "@/components/screen-error";

export default function AgentError(props: ErrorPageProps) {
  return <ScreenError {...props} title="The job agent didn't load" />;
}
