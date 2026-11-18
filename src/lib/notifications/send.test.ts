import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SendError, sendMessage, webhookSignature, type OutgoingMessage } from "./send";

const mail = vi.hoisted(() => ({ sent: [] as unknown[], options: [] as unknown[], fail: null as unknown }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: (options: unknown) => {
      mail.options.push(options);
      return {
        sendMail: async (message: unknown) => {
          if (mail.fail) throw mail.fail;
          mail.sent.push(message);
        },
        close: () => {},
      };
    },
  },
}));

const message: OutgoingMessage = { event: "agent.run.finished", title: "Agent run finished · 2 new postings", text: "Backend: 2 new", link: "https://dossier.example/jobs?found=agent", at: "2026-11-16T07:00:00.000Z", data: { newCount: 2 } };
const now = new Date("2026-11-16T07:00:00Z");
const fetchOk = () => vi.fn(async () => new Response("", { status: 200 }));
const call = (fetchImpl: ReturnType<typeof vi.fn>) => fetchImpl.mock.calls[0] as unknown as [string, RequestInit];

beforeEach(() => {
  mail.sent = [];
  mail.options = [];
  mail.fail = null;
});

describe("webhooks (E26-2)", () => {
  it("post the whole event as JSON, signed Stripe-style with the channel's secret", async () => {
    const fetchImpl = fetchOk();
    await sendMessage({ type: "WEBHOOK", name: "n8n", config: { url: "http://n8n.local:5678/webhook/x" }, secret: "whsec_test" }, message, { fetchImpl, now });
    const [url, init] = call(fetchImpl);
    // A local address is allowed: the user set it.
    expect(url).toBe("http://n8n.local:5678/webhook/x");
    const body = init.body as string;
    expect(JSON.parse(body)).toEqual({ event: "agent.run.finished", title: message.title, text: message.text, link: message.link, at: message.at, data: { newCount: 2 } });
    const headers = new Headers(init.headers);
    const seconds = Math.floor(now.getTime() / 1000);
    expect(headers.get("x-dossier-signature")).toBe(`t=${seconds},v1=${createHmac("sha256", "whsec_test").update(`${seconds}.${body}`).digest("hex")}`);
    expect(headers.get("x-dossier-event")).toBe("agent.run.finished");
    expect(webhookSignature("k", "{}", 1)).toMatch(/^t=1,v1=[0-9a-f]{64}$/);
  });

  it("say why a target refused or couldn't be reached", async () => {
    const answer = (status: number) => vi.fn(async () => new Response("the target's own long answer", { status }));
    const channel = { type: "WEBHOOK" as const, name: "n8n", config: { url: "https://n8n.example/x" }, secret: "s" };
    await expect(sendMessage(channel, message, { fetchImpl: answer(404) })).rejects.toThrow(new SendError("The webhook answered 404: check the address."));
    await expect(sendMessage(channel, message, { fetchImpl: answer(500) })).rejects.toThrow("The webhook answered 500.");
    const unreachable = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(sendMessage(channel, message, { fetchImpl: unreachable })).rejects.toThrow("Couldn't reach the webhook: check the address, and that the server can reach it.");
  });
});

describe("ntfy (E26-2)", () => {
  it("publishes the title, the text and the link as the tap action, with the access token", async () => {
    const fetchImpl = fetchOk();
    await sendMessage({ type: "NTFY", name: "Phone", config: { server: "https://ntfy.example/", topic: "dossier-x7" }, secret: "tk_123" }, message, { fetchImpl, now });
    const [url, init] = call(fetchImpl);
    expect(url).toBe("https://ntfy.example/");
    expect(JSON.parse(init.body as string)).toEqual({ topic: "dossier-x7", title: message.title, message: message.text, click: message.link });
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tk_123");
  });

  it("leaves the tap action out without a link", async () => {
    const fetchImpl = fetchOk();
    await sendMessage({ type: "NTFY", name: "Phone", config: { server: "https://ntfy.sh", topic: "t" }, secret: null }, { ...message, link: null }, { fetchImpl });
    expect(JSON.parse(call(fetchImpl)[1].body as string)).not.toHaveProperty("click");
    expect(new Headers(call(fetchImpl)[1].headers).get("authorization")).toBeNull();
  });
});

describe("email (E26-2)", () => {
  it("sends the subject, the text and the link through the SMTP server, TLS on 465", async () => {
    await sendMessage({ type: "EMAIL", name: "Inbox", config: { host: "smtp.example.com", port: 465, user: "me", from: "dossier@example.com", to: "me@example.com" }, secret: "pw" }, message);
    expect(mail.options[0]).toMatchObject({ host: "smtp.example.com", port: 465, secure: true, auth: { user: "me", pass: "pw" } });
    expect(mail.sent[0]).toMatchObject({ from: "dossier@example.com", to: "me@example.com", subject: message.title, text: `${message.text}\n\n${message.link}` });
  });

  it("says what went wrong in words", async () => {
    const channel = { type: "EMAIL" as const, name: "Inbox", config: { host: "smtp.example.com", port: 587, user: "me", from: "a@b.c", to: "d@e.f" }, secret: "pw" };
    mail.fail = Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 });
    await expect(sendMessage(channel, message)).rejects.toThrow("The SMTP server didn't accept the user and password.");
    mail.fail = Object.assign(new Error("connect ECONNREFUSED"), { code: "ESOCKET" });
    await expect(sendMessage(channel, message)).rejects.toThrow("Couldn't reach the SMTP server: check its name and port.");
    expect(mail.options.at(-1)).toMatchObject({ secure: false });
  });
});
