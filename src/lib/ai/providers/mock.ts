import type { TokenCount, UsageSink } from "@/lib/usage";

import { BaseProvider, type ChatAnswer, type ChatCall } from "../provider";

export type MockReply = (call: ChatCall) => unknown;

/**
 * A provider that answers from code, for tests and end-to-end runs (E11-2).
 * A reply that isn't a string is sent as JSON, so structured answers go
 * through the same validation as a real model's.
 */
export class MockProvider extends BaseProvider {
  readonly kind = "MOCK" as const;
  /** Every call it received, newest last. */
  readonly calls: ChatCall[] = [];

  constructor(
    private readonly options: {
      model?: string | null;
      models?: string[];
      reply?: MockReply;
      timeoutMs?: number;
      /** What each answer reports it used; nothing by default. */
      tokens?: TokenCount;
      onUsage?: UsageSink;
    } = {},
  ) {
    super(options.model === undefined ? "mock-model" : options.model, options.timeoutMs ?? 60_000, options.onUsage);
  }

  protected async chat(call: ChatCall): Promise<ChatAnswer> {
    this.calls.push(call);
    const answer = await (this.options.reply ?? (() => "OK"))(call);
    call.used(this.options.tokens ?? { input: null, output: null });
    return { text: typeof answer === "string" ? answer : JSON.stringify(answer), cutOff: false };
  }

  protected async fetchModels(): Promise<string[]> {
    return this.options.models ?? ["mock-model"];
  }
}
