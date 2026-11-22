import type { Metadata } from "next";

import { periodFromParam } from "@/lib/dashboard";
import { userTimeZone } from "@/lib/time-zone";
import { loadUsage } from "@/lib/usage-data";

import { UsageScreen } from "./usage-screen";

export const metadata: Metadata = { title: "Usage" };

/** Tokens used per AI task (#290). `?period=` picks the time filter, the last 30 days unless it says otherwise. */
export default async function UsagePage({ searchParams }: PageProps<"/usage">) {
  const [{ period: param }, timeZone] = await Promise.all([searchParams, userTimeZone()]);
  const period = periodFromParam(param) ?? "30d";
  const { figures, countingSince } = await loadUsage(period);
  return <UsageScreen figures={figures} period={period} countingSince={countingSince} timeZone={timeZone} />;
}
