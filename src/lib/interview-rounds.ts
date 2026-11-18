import { z } from "zod";

// What the server and the page share about interview rounds (E30-6).

/** Interview.prep: "Getting ready", with its ticks. */
export const prepSchema = z.array(z.object({ text: z.string(), why: z.string().default(""), done: z.boolean().default(false), doneAt: z.iso.datetime().nullish() }));
export type Prep = z.infer<typeof prepSchema>;

type Round = { id: string; round: number; at: Date | null };

/** The round still to come: the last one, while it has no date or its date is ahead. */
export function upcomingRound<T extends Round>(rounds: readonly T[], now = new Date()): T | null {
  const last = rounds.toSorted((a, b) => a.round - b.round).at(-1);
  return last && (last.at === null || last.at.getTime() > now.getTime()) ? last : null;
}
