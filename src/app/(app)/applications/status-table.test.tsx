import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { applicationRow } from "@/test/application-row";

import { StatusTable } from "./status-table";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} /> }));
vi.mock("@/components/change-status", () => ({ changeStatus: vi.fn() }));

const headers = () => screen.getAllByRole("columnheader").map((header) => header.textContent);
const cells = (name: RegExp) => within(screen.getByRole("row", { name })).getAllByRole("cell").map((cell) => cell.textContent);

describe("a status's own list (E29-2)", () => {
  it("shows a draft's deadline, match and documents, with Finish draft or Review and send", () => {
    const due = { kind: "apply-by", text: "Apply by Thu 19 Nov · 3 days", due: new Date("2026-11-19T00:00:00Z"), soon: true } as const;
    render(
      <StatusTable
        status="DRAFT"
        onMove={vi.fn()}
        rows={[
          applicationRow("later", { status: "DRAFT", role: "Later", deadline: "4 Dec 2026", flag: { ...due, text: "Apply by Fri 4 Dec · 18 days", due: new Date("2026-12-04T00:00:00Z"), soon: false }, docs: { resume: false, letter: false } }),
          applicationRow("soon", { status: "DRAFT", role: "Soon", deadline: "19 Nov 2026", flag: due }),
        ]}
      />,
    );
    expect(headers()).toEqual(["Application", "Apply by", "Match", "Docs ready", "Next step", "Actions"]);
    // Due soonest first.
    expect(screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("link")[0].textContent)).toEqual(["Soon", "Later"]);
    expect(cells(/^Soon/)).toEqual(["SoonLedgerly · Amsterdam · Hybrid", "Thu 19 Nov · 3 days", "5/7", "Resume and letter", "Review and send for Soon, Ledgerly", "⋯"]);
    expect(screen.getByText("Thu 19 Nov · 3 days")).toHaveClass("text-warning");
    expect(screen.getByRole("link", { name: "Review and send for Soon, Ledgerly" })).toHaveAttribute("href", "/applications/soon?tab=email");
    expect(screen.getByRole("link", { name: "Finish draft for Later, Ledgerly" })).toHaveAttribute("href", "/applications/later");
  });

  it("shows when and how a sent one went out, how long it's been quiet, and a follow-up once it's due", () => {
    render(
      <StatusTable
        status="SENT"
        onMove={vi.fn()}
        rows={[
          applicationRow("recent", { role: "Recent", sent: "14 Nov", quietDays: 2 }),
          applicationRow("quiet", { role: "Quiet", sent: "2 Nov", sentWay: "With Gmail", quietDays: 14, flag: { kind: "quiet", text: "Quiet for 14 days", due: null, soon: true } }),
        ]}
      />,
    );
    expect(headers()).toEqual(["Application", "Sent", "Quiet for", "Match", "Next step", "Actions"]);
    expect(cells(/^Quiet/).slice(1, 4)).toEqual(["2 NovWith Gmail", "14 days", "5/7"]);
    expect(screen.getByText("14 days")).toHaveClass("text-warning");
    expect(screen.getByRole("link", { name: /^Draft a follow-up for Quiet/ })).toHaveAttribute("href", "/applications/quiet?tab=email&start=follow-up");
    expect(within(screen.getByRole("row", { name: /^Recent/ })).queryByRole("link", { name: /follow-up/ })).not.toBeInTheDocument();
  });

  it("shows the last reply in screening, the next interview, and an offer's salary", () => {
    const { unmount } = render(
      <StatusTable status="SCREENING" onMove={vi.fn()} rows={[applicationRow("s", { status: "SCREENING", role: "Screened", lastReply: { on: "12 Nov", from: "Ana at Tidewater" }, waiting: 1 })]} />,
    );
    expect(headers()).toEqual(["Application", "Last reply", "From", "Next step", "Actions"]);
    expect(cells(/^Screened/).slice(1, 4)).toEqual(["12 Nov", "Ana at Tidewater", "Answer for Screened, Ledgerly"]);
    expect(screen.getByRole("link", { name: /^Answer/ })).toHaveAttribute("href", "/applications/s?tab=conversation");
    unmount();

    const second = render(<StatusTable status="INTERVIEW" onMove={vi.fn()} rows={[applicationRow("i", { status: "INTERVIEW", role: "Interviewing", nextInterview: "Thu 19 Nov, 14:00" })]} />);
    expect(headers()).toEqual(["Application", "Next interview", "Round", "Next step", "Actions"]);
    expect(cells(/^Interviewing/).slice(1, 4)).toEqual(["Thu 19 Nov, 14:00", "–", "Prepare for Interviewing, Ledgerly"]);
    second.unmount();

    render(<StatusTable status="OFFER" onMove={vi.fn()} rows={[applicationRow("o", { status: "OFFER", role: "Offered", salary: "€75,000–90,000" })]} />);
    expect(headers()).toEqual(["Application", "Salary", "Decide by", "Next step", "Actions"]);
    expect(cells(/^Offered/).slice(1, 4)).toEqual(["€75,000–90,000", "–", "Review offer for Offered, Ledgerly"]);
  });
});
