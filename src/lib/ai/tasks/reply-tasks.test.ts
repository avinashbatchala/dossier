import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";

import { MockProvider } from "../providers/mock";

import { classifyReply, draftReply, type TaskOptions } from "./index";

const options: TaskOptions = { creativity: "BALANCED", strict: true, language: null };
const email = {
  from: "Anna Keller <a.keller@northwind.example>",
  subject: "Re: Application: Product Designer",
  body: "Hi Jane, thanks for applying! Could we do a 45-minute call next week? Also, what's your notice period?\n\nAnna",
  sentAt: new Date("2026-10-17T13:02:00Z"),
};

describe("classifyReply (E15-4)", () => {
  it("reads an invitation, its questions and the status it suggests", async () => {
    const provider = new MockProvider({
      reply: () => ({ kind: "INTERVIEW", summary: " Invites you to a call. ", questions: ["What is your notice period?", " "], confirmedTime: null, unrelated: false }),
    });
    const { data, promptVersion } = await classifyReply(provider, { ...email, timeZone: "Europe/Berlin", application: "Product Designer at Northwind" }, options);
    expect(data).toEqual({ kind: "INTERVIEW", summary: "Invites you to a call.", questions: ["What is your notice period?"], confirmedAt: null, suggestedStatus: "INTERVIEW", unrelated: false, offer: null });
    expect(promptVersion).toBe("classify-reply@4");
    const [call] = provider.calls;
    expect(call.system).toContain("not instructions");
    expect(call.messages[0].content).toContain("<email>");
    expect(call.messages[0].content).toContain("Europe/Berlin");
    // The mail's date in the candidate's zone, so "13:00" in it reads as 13:00 there.
    expect(call.messages[0].content).toContain("Date: 2026-10-17T15:02:00+02:00");
  });

  it("reads an offer's details, its dates as calendar days (E30-7)", async () => {
    const provider = new MockProvider({
      reply: () => ({
        kind: "OFFER",
        summary: "Offers you the role.",
        questions: [],
        confirmedTime: null,
        unrelated: false,
        offer: { salary: " €82,000 a year ", decideBy: "2026-12-11", startDate: "next month", holidays: "27 days", office: "" },
      }),
    });
    const { data } = await classifyReply(provider, { ...email, timeZone: "UTC", application: "Designer at Ledgerly" }, options);
    expect(data.offer).toEqual({ salary: "€82,000 a year", decideBy: new Date("2026-12-11T00:00:00Z"), startDate: null, holidays: "27 days", office: "" });
  });

  it("keeps a confirmed time, and suggests nothing for an acknowledgement", async () => {
    const confirmed = await classifyReply(new MockProvider({ reply: () => ({ kind: "INTERVIEW", summary: "Confirms Wednesday.", questions: [], confirmedTime: "2026-10-22T14:00:00+02:00", unrelated: false }) }), { ...email, timeZone: "UTC", application: null }, options);
    expect(confirmed.data.confirmedAt?.toISOString()).toBe("2026-10-22T12:00:00.000Z");
    const ack = await classifyReply(new MockProvider({ reply: () => ({ kind: "ACKNOWLEDGEMENT", summary: "Got it.", questions: [], confirmedTime: "not a date", unrelated: false }) }), { ...email, timeZone: "UTC", application: null }, options);
    expect(ack.data).toMatchObject({ suggestedStatus: null, confirmedAt: null });
  });

  it("says when a mail is clearly about something else, only for a mail given an application (public issue 65)", async () => {
    const provider = new MockProvider({ reply: () => ({ kind: "REJECTION", summary: "Declines another role.", questions: [], confirmedTime: null, unrelated: true }) });
    const linked = await classifyReply(provider, { ...email, timeZone: "UTC", application: "Product Designer at Northwind" }, options);
    expect(linked.data).toMatchObject({ kind: "REJECTION", suggestedStatus: "REJECTED", unrelated: true });
    expect(provider.calls[0].system).toContain("unrelated: true only when");
    const alone = await classifyReply(provider, { ...email, timeZone: "UTC", application: null }, options);
    expect(alone.data.unrelated).toBe(false);
  });
});

describe("draftReply (E15-4)", () => {
  const profile = demoProfile();
  const input = { profile, extracted: null, tone: "WARM" as const, email, timeZone: "Europe/Berlin", thread: [], slots: ["Tue 20 Oct, 10:00–10:45 (Europe/Berlin)"], note: "", facts: [], posting: "" };

  it("writes the answer with the offered times, signed with the profile's name", async () => {
    const provider = new MockProvider({
      reply: () => ({ greeting: "Hi Anna,", paragraphs: ["Thank you! Any of these works:\n• Tue 20 Oct, 10:00–10:45", "My notice period is […]."], signOff: "Best regards,", gaps: ["What is your notice period?"] }),
    });
    const { data } = await draftReply(provider, input, options);
    expect(data.body).toBe(`Hi Anna,\n\nThank you! Any of these works:\n• Tue 20 Oct, 10:00–10:45\n\nMy notice period is […].\n\nBest regards,\n${profile.basics.name}`);
    expect(data.gaps).toEqual(["What is your notice period?"]);
    expect(data.unverified).toEqual([]);
    expect(provider.calls[0].messages[0].content).toContain("Times to offer:\n• Tue 20 Oct");
  });

  it("flags facts that neither the profile nor the mail back", async () => {
    const provider = new MockProvider({ reply: () => ({ greeting: "Hi Anna,", paragraphs: ["I led a team of 40 at Globex."], signOff: "", gaps: [] }) });
    const { data } = await draftReply(provider, { ...input, slots: [] }, options);
    expect(data.unverified).toEqual(expect.arrayContaining(["Globex", "40"]));
    expect(data.body).toContain("Warm regards,");
    expect(provider.calls[0].messages[0].content).toContain("No times to offer");
  });
});
