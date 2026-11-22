import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usageFigures } from "@/lib/usage";

import { UsageScreen } from "./usage-screen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/usage" }));
vi.mock("../actions", () => ({ rememberDashboardPeriod: vi.fn() }));

const figures = usageFigures([
  { task: "tailor-resume", requests: 4, inputRequests: 4, input: 24_000, outputRequests: 4, output: 6_500 },
  { task: "score-posting-jev", requests: 12, inputRequests: 12, input: 30_000, outputRequests: 0, output: 0 },
  { task: "classify-reply", requests: 2, inputRequests: 0, input: 0, outputRequests: 0, output: 0 },
  { task: "draft-reply", requests: 3, inputRequests: 2, input: 1_800, outputRequests: 2, output: 400 },
]);

/** A row's cells after its task: requests, input, output, total. */
const cells = (task: string) =>
  within(screen.getByRole("rowheader", { name: new RegExp(`^${task}`) }).closest("tr")!)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);

describe("UsageScreen (#290)", () => {
  it("lists every task with its requests and tokens, most used first, and the sum", () => {
    render(<UsageScreen figures={figures} period="30d" countingSince={new Date("2026-11-01T09:00:00Z")} timeZone="UTC" />);
    expect(screen.getByRole("heading", { level: 1, name: "Usage" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Tokens by task, last 30 days" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Last 30 days" })).toBeChecked();
    const tasks = screen.getAllByRole("rowheader").map((header) => header.querySelector("span")?.textContent ?? header.textContent);
    expect(tasks.slice(0, 2)).toEqual(["Writing resumes", "Scoring postings with Jev"]);
    expect(tasks).toHaveLength(21);
    expect(tasks.at(-1)).toBe("All tasks");
    expect(cells("Writing resumes")).toEqual(["4", "24,000", "6,500", "30,500"]);
    expect(cells("Connection checks")).toEqual(["0", "0", "0", "0"]);
    expect(cells("All tasks")).toEqual(["21", "55,8003 requests not reported", "6,90015 requests not reported", "62,700"]);
  });

  it("says Not reported for counts a server didn't send, and how many requests lacked one", () => {
    render(<UsageScreen figures={figures} period="30d" countingSince={new Date("2026-11-01T09:00:00Z")} timeZone="UTC" />);
    expect(cells("Reading replies")).toEqual(["2", "Not reported", "Not reported", "Not reported"]);
    expect(cells("Scoring postings with Jev")).toEqual(["12", "30,000", "Not reported", "30,000"]);
    expect(cells("Drafting answers")).toEqual(["3", "1,8001 request not reported", "4001 request not reported", "2,200"]);
    expect(screen.getByText(/Counting since Sun 1 Nov\. “Not reported” means the server didn't say/)).toBeInTheDocument();
  });

  it("says nothing's counted yet before the first request", () => {
    render(<UsageScreen figures={usageFigures([])} period="all" countingSince={null} />);
    expect(screen.getByText("Nothing counted yet. Every AI request counts from now on.")).toBeInTheDocument();
    expect(cells("All tasks")).toEqual(["0", "0", "0", "0"]);
  });
});
