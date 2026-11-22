import { beforeEach, expect, it, vi } from "vitest";

import { withAgentScanLock } from "./scan-lock";

const fake = vi.hoisted(() => ({
  connect: vi.fn(async () => {}),
  query: vi.fn(async () => ({ rows: [{ locked: true }] })),
  end: vi.fn(async () => {}),
}));
vi.mock("pg", () => ({ Client: class {
  on() {}
  connect = fake.connect;
  query = fake.query;
  end = fake.end;
} }));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); });

it("cleans up failed connects, without masking the original connection error", async () => {
  fake.connect.mockRejectedValueOnce(new Error("connect failed"));
  fake.end.mockRejectedValueOnce(new Error("close failed too"));
  const work = vi.fn(async () => "unused");
  await expect(withAgentScanLock(work, "postgresql://unused")).rejects.toThrow("connect failed");
  expect(fake.end).toHaveBeenCalledOnce();
  expect(work).not.toHaveBeenCalled();
});

it("preserves evaluation errors when cleanup also fails", async () => {
  fake.end.mockRejectedValueOnce(new Error("close failed"));
  await expect(withAgentScanLock(async () => { throw new Error("evaluation failed"); }, "postgresql://unused")).rejects.toThrow("evaluation failed");
  expect(fake.end).toHaveBeenCalledOnce();
});
