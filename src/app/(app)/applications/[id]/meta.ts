import type { SentVia } from "@/generated/prisma/enums";
import { sentLine } from "@/lib/application-flag";
import { formatCalendarDate, formatDate } from "@/lib/dates";

/**
 * Location · work mode · salary · "Apply by …" · "Created …", leaving out
 * empty parts (APP-1), then "Sent 2 Nov by Gmail" once sent (E29-7), and the
 * profile it was made from when there's more than one (E24-6).
 */
export function metaLine(
  application: {
    location: string;
    mode: string;
    salary: string;
    deadline: Date | null;
    createdAt: Date;
    sentAt?: Date | null;
    sentVia?: SentVia | null;
  },
  profileName = "",
  { now = new Date(), timeZone }: { now?: Date; timeZone?: string } = {},
): string[] {
  return [
    application.location.trim(),
    application.mode.trim(),
    application.salary.trim(),
    application.deadline ? `Apply by ${formatCalendarDate(application.deadline)}` : "",
    `Created ${formatDate(application.createdAt)}`,
    application.sentAt ? sentLine(application.sentAt, application.sentVia ?? null, { now, timeZone }) : "",
    profileName ? `From “${profileName}”` : "",
  ].filter(Boolean);
}

/** A role as "Where you used it" lists it (E30-5): "Northwind Logistics, 2021 – now". */
export function roleLabel(role: { company: string; role: string; startYear: number | null; endYear: number | null; current: boolean }): string {
  const name = role.company.trim() || role.role.trim() || "A role without a name";
  const end = role.current ? "now" : role.endYear ? String(role.endYear) : "";
  const years = role.startYear ? (end ? `${role.startYear} – ${end}` : String(role.startYear)) : end;
  return years ? `${name}, ${years}` : name;
}
