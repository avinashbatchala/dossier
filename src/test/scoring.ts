import type { ChatCall } from "@/lib/ai/provider";

// What a fake AI model answers to score-posting (E25-1), for tests: the
// engine's questions, every line a covered must-have, at one of three
// levels that add up to 100, 71 or 8.

export type FakeFit = "high" | "mid" | "low";

/** The posting's facts in a score-posting call: its title, company and place. */
export function scoredPosting(call: ChatCall): { title: string; company: string; place: string } {
  const facts = call.messages[0].content.split("The posting's facts:\n")[1].split("\n\nThe posting's lines:")[0];
  return JSON.parse(facts) as { title: string; company: string; place: string };
}

/** The numbered lines in a score-posting call. */
const linesOf = (call: ChatCall) =>
  (call.messages[0].content.split("The posting's lines:\n")[1]?.split("\n\nThe posting:")[0] ?? "")
    .split("\n")
    .filter((line) => /^\d+: /.test(line));

/**
 * A posting_factors answer: "high" scores 100, every line a covered
 * must-have; "mid" 71, with no requirements, past work related and a step
 * above in level; "low" 8, nothing close and far above in level.
 */
export function factorsAnswer(call: ChatCall, fit: FakeFit) {
  const reason = (text: string) => ({ reason: text });
  return {
    requirements: fit === "high" ? linesOf(call).map((_, index) => ({ line: index, kind: "must", covered: true, evidence: "Senior Product Designer at Northwind Logistics", skill: "" })) : [],
    work: { level: fit === "high" ? 3 : fit === "mid" ? 2 : 0, ...reason(`Work: ${fit}.`) },
    extra: { level: fit === "high" ? 3 : fit === "mid" ? 1 : 0, ...reason(`Extra: ${fit}.`) },
    education: { level: fit === "low" ? 0 : 2, ...reason(`Education: ${fit}.`) },
    seniority: { fit: fit === "high" ? "fits" : fit === "mid" ? "above" : "far-above", ...reason(`Seniority: ${fit}.`) },
    location: { fit: fit === "low" ? "stretch" : "fits", ...reason(`Location: ${fit}.`) },
    thin: false,
  };
}
