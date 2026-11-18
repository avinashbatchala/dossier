import { describe, expect, it } from "vitest";

import { EVENT_NAMES, EVENTS, eventOn } from "./events";

describe("the events (E26-1)", () => {
  it("are on by default only for agent runs, withdrawn portals and documents written", () => {
    expect(EVENT_NAMES.filter((name) => EVENTS[name].on)).toEqual(["agent.run.finished", "portal.withdrawn", "documents.written"]);
    expect(eventOn({}, "draft.ready")).toBe(false);
    expect(eventOn({ "draft.ready": true, "agent.run.finished": false }, "agent.run.finished")).toBe(false);
  });

  it("build an agent run's message: what's new for each search with its best posting, then the failed portals", () => {
    const data = {
      newCount: 15,
      searches: [
        { name: "Backend, Berlin", newCount: 9, best: { title: "Backend Engineer", company: "Zalando", coverage: { hit: 5, total: 6 }, profile: "Backend" } },
        { name: "Remote frontend", newCount: 6, best: { title: "Frontend Developer", company: "Doist", coverage: null, profile: "Frontend" } },
      ],
      failed: [
        { portal: "JSearch", why: "out of searches" },
        { portal: "Jobicy", why: "no answer" },
      ],
      postings: [],
      path: "/jobs?found=agent",
    };
    expect(EVENTS["agent.run.finished"].message(data)).toEqual({
      title: "Agent run finished · 15 new postings",
      text: [
        "Backend, Berlin: 9 new · best Backend Engineer at Zalando, covers 5 of 6 (Backend)",
        "Remote frontend: 6 new · best Frontend Developer at Doist (Frontend)",
        "2 portals failed: JSearch (out of searches), Jobicy (no answer)",
      ].join("\n"),
      path: "/jobs?found=agent",
    });
    expect(EVENTS["agent.run.finished"].hasNews!({ ...data, newCount: 0, failed: [] })).toBe(false);
  });

  it("say who replied about which application, never what the mail says", () => {
    expect(EVENTS["reply.arrived"].message({ applicationId: "a1", from: "Jane at Ledgerly", title: "Senior Product Designer", company: "Ledgerly" })).toEqual({
      title: "A reply from Jane at Ledgerly",
      text: "About Senior Product Designer at Ledgerly.",
      path: "/applications/a1?tab=email",
    });
  });

  it("say which documents New application wrote, never what they say (E31-4)", () => {
    expect(EVENTS["documents.written"].message({ applicationId: "a1", title: "Senior Product Designer", company: "Ledgerly", resume: true, letter: true })).toEqual({
      title: "Your resume and cover letter are ready",
      text: "For Senior Product Designer at Ledgerly. Nothing is sent until you say so.",
      path: "/applications/a1",
    });
    expect(EVENTS["documents.written"].message({ applicationId: "a1", title: "Designer", company: "", resume: true, letter: false }).title).toBe("Your resume is ready");
  });
});
