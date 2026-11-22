import type { ApplicationRow } from "@/lib/applications-data";

/** An application as the board and the list get it, for tests: a Sent one at Ledgerly unless told otherwise. */
export const applicationRow = (id: string, extra: Partial<ApplicationRow> = {}): ApplicationRow => ({
  id,
  company: "Ledgerly",
  role: "Senior Product Designer",
  location: "Amsterdam",
  mode: "Hybrid",
  status: "SENT",
  furthestStage: "SENT",
  archived: false,
  deadline: null,
  match: { hit: 5, total: 7 },
  sent: "20 Sep",
  sentWay: "",
  quietDays: 2,
  docs: { resume: true, letter: true },
  lastReply: null,
  waiting: 0,
  nextInterview: null,
  round: null,
  salary: "",
  flag: null,
  updated: "2 days ago",
  updatedAt: Date.UTC(2026, 8, 26),
  boardSort: null,
  ...extra,
});
