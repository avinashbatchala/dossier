"use client";

import { useEffect, useSyncExternalStore } from "react";

import { dayPeriod, TIME_ZONE_COOKIE, type DayPeriod } from "@/lib/greeting";

const never = () => () => {};
const YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * "Good afternoon, Jane" (DSH-1) in the browser's local time. The server
 * greets from the time zone it was told last time; the browser corrects it
 * if needed and remembers its zone for next time.
 */
export function Greeting({ name, serverPeriod }: { name: string; serverPeriod: DayPeriod }) {
  const period = useSyncExternalStore(never, () => dayPeriod(new Date().getHours()), () => serverPeriod);

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=${YEAR_SECONDS}; samesite=lax`;
  }, []);

  return (
    <>
      Good {period}
      {name && `, ${name}`}
    </>
  );
}
