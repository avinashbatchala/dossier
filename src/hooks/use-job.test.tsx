import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JOB_GONE, useJob } from "./use-job";

/** A stand-in for the browser's EventSource that the test drives. */
class FakeEventSource {
  static last: FakeEventSource | undefined;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  send(data: object) {
    act(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) })));
  }
  close() {
    this.closed = true;
  }
}

const job = (status: string, step: string | null = null) => ({ id: "job-1", type: "extract", status, step, error: null, result: null });

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

describe("useJob", () => {
  it("follows a job through its event stream and stops when it's done", () => {
    const { result } = renderHook(() => useJob("job-1"));
    const source = FakeEventSource.last!;
    expect(source.url).toBe("/api/jobs/job-1/events");
    source.send(job("RUNNING", "Reading the posting"));
    expect(result.current).toMatchObject({ status: "RUNNING", step: "Reading the posting" });
    source.send(job("DONE", "Reading the posting"));
    expect(result.current?.status).toBe("DONE");
    expect(source.closed).toBe(true);
  });

  it("falls back to polling when the stream breaks", async () => {
    const fetch = vi.fn(async () => Response.json(job("DONE", "Writing your documents")));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useJob("job-1"));
    act(() => FakeEventSource.last!.onerror?.());
    await waitFor(() => expect(result.current?.status).toBe("DONE"));
    expect(fetch).toHaveBeenCalledWith("/api/jobs/job-1");
  });

  it("stops asking about a job that's gone, and says so", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "That job doesn't exist." }, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useJob("job-1"));
    act(() => FakeEventSource.last!.onerror?.());
    await waitFor(() => expect(result.current).toMatchObject({ status: "FAILED", error: JOB_GONE }));
    // Longer than the poll interval.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("follows nothing without an id, and starts over for a new run", () => {
    const { result, rerender } = renderHook(({ revision }) => useJob("job-1", revision), { initialProps: { revision: 0 } });
    const first = FakeEventSource.last!;
    first.send(job("FAILED"));
    rerender({ revision: 1 });
    expect(first.closed).toBe(true);
    expect(FakeEventSource.last).not.toBe(first);
    FakeEventSource.last!.send(job("RUNNING", "Again"));
    expect(result.current?.step).toBe("Again");
    expect(renderHook(() => useJob(null)).result.current).toBeNull();
  });
});
