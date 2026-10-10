import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { webhook } from "@/server-routes/api/connect";
import {
  InMemoryWebhookEventStore,
  hashWebhookPayload,
  processPendingWebhooks,
} from "@/lib/connectors/webhook-event-store";
import {
  WEBHOOK_MAX_BYTES,
  WEBHOOK_REPLAY_WINDOW_SECONDS,
  verifyWebhookSignature,
} from "@/lib/connectors/webhook-verification";

const SECRET = "connect-webhook-secret-0123456789";
const EVENT_ID = "a1b2c3d4-event";

function env(extra: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    GITHUB_WEBHOOK_SECRET: SECRET,
    SLACK_SIGNING_SECRET: SECRET,
    LINEAR_WEBHOOK_SECRET: SECRET,
    ...extra,
  };
}

function githubSigned(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function slackSigned(body: string, timestamp: number, secret = SECRET): string {
  const base = `v0:${timestamp}:${body}`;
  return `v0=${createHmac("sha256", secret).update(base, "utf8").digest("hex")}`;
}

function request(
  body: string,
  headers: Record<string, string>,
): Request {
  return new Request("https://example.test/api/connect/github/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("connect webhooks: verificación de firma (ISA-199/ISA-205/ISA-211)", () => {
  it("accepts a valid GitHub HMAC signature and deduplicates re-deliveries", async () => {
    const store = new InMemoryWebhookEventStore();
    const body = JSON.stringify({ action: "opened", number: 1 });
    const headers = {
      "x-github-delivery": EVENT_ID,
      "x-hub-signature-256": githubSigned(body),
    };

    const first = await webhook(request(body, headers), "github", { store, env: env() });
    expect(first.status).toBe(200);
    expect(await readJson(first)).toMatchObject({
      accepted: true,
      duplicate: false,
      eventId: EVENT_ID,
    });

    const second = await webhook(request(body, headers), "github", { store, env: env() });
    expect(second.status).toBe(200);
    expect(await readJson(second)).toMatchObject({ accepted: true, duplicate: true });
  });

  it("rejects an altered body with 401 and never echoes the signature", async () => {
    const store = new InMemoryWebhookEventStore();
    const body = JSON.stringify({ action: "opened" });
    const headers = {
      "x-github-delivery": EVENT_ID,
      "x-hub-signature-256": githubSigned(body),
    };
    const response = await webhook(request(JSON.stringify({ action: "closed" }), headers), "github", {
      store,
      env: env(),
    });
    expect(response.status).toBe(401);
    const payload = await readJson(response);
    expect(payload).toEqual({ accepted: false, error: "WEBHOOK_SIGNATURE_INVALID" });
    expect(JSON.stringify(payload)).not.toContain("sha256=");
  });

  it("rejects missing signatures and missing secrets (fail-closed)", async () => {
    const store = new InMemoryWebhookEventStore();
    const body = "{}";
    const missingSignature = await webhook(
      request(body, { "x-github-delivery": EVENT_ID }),
      "github",
      { store, env: env() },
    );
    expect(missingSignature.status).toBe(401);
    expect(await readJson(missingSignature)).toMatchObject({
      error: "WEBHOOK_SIGNATURE_MISSING",
    });

    const missingSecret = verifyWebhookSignature({
      provider: "github",
      rawBody: body,
      byteLength: 2,
      headers: new Headers({
        "x-github-delivery": EVENT_ID,
        "x-hub-signature-256": githubSigned(body),
      }),
      secret: undefined,
    });
    expect(missingSecret).toEqual({ ok: false, code: "WEBHOOK_SECRET_NOT_CONFIGURED" });
  });

  it("rejects sha1-only signatures as algorithm downgrade", async () => {
    const result = verifyWebhookSignature({
      provider: "github",
      rawBody: "{}",
      byteLength: 2,
      headers: new Headers({ "x-hub-signature": "sha1=deadbeef" }),
      secret: undefined,
    });
    // Sin secreto, el fail-closed prevalece sobre el downgrade.
    expect(result).toEqual({ ok: false, code: "WEBHOOK_SECRET_NOT_CONFIGURED" });

    const withSecret = verifyWebhookSignature({
      provider: "github",
      rawBody: "{}",
      byteLength: 2,
      headers: new Headers({ "x-hub-signature": "sha1=deadbeef" }),
      secret: SECRET,
    });
    expect(withSecret).toEqual({ ok: false, code: "WEBHOOK_ALGORITHM_DOWNGRADE" });
  });

  it("rejects oversized payloads before parsing (ISA-206)", async () => {
    const store = new InMemoryWebhookEventStore();
    const bigBody = "x".repeat(WEBHOOK_MAX_BYTES + 1);
    const response = await webhook(
      request(bigBody, { "x-github-delivery": EVENT_ID, "x-hub-signature-256": "sha256=00" }),
      "github",
      { store, env: env() },
    );
    expect(response.status).toBe(413);
    expect(await readJson(response)).toMatchObject({ error: "WEBHOOK_PAYLOAD_TOO_LARGE" });
  });

  it("rejects events without a provider event id (ISA-200)", async () => {
    const store = new InMemoryWebhookEventStore();
    const body = "{}";
    const response = await webhook(
      request(body, { "x-hub-signature-256": githubSigned(body) }),
      "github",
      { store, env: env() },
    );
    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({
      error: "CONNECT_EVENT_ID_REQUIRED",
    });
  });
});

describe("connect webhooks: replay window de Slack (ISA-201)", () => {
  const now = Math.floor(Date.now() / 1000);

  it("accepts a fresh correctly signed event", () => {
    const body = JSON.stringify({ type: "event_callback" });
    const result = verifyWebhookSignature({
      provider: "slack",
      rawBody: body,
      byteLength: Buffer.byteLength(body),
      headers: new Headers({
        "x-slack-signature": slackSigned(body, now),
        "x-slack-request-timestamp": String(now),
      }),
      secret: SECRET,
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: true, scheme: "hmac-sha256-slack-v0" });
  });

  it("rejects replayed timestamps outside the window", () => {
    const body = JSON.stringify({ type: "event_callback" });
    const stale = now - (WEBHOOK_REPLAY_WINDOW_SECONDS + 1);
    const result = verifyWebhookSignature({
      provider: "slack",
      rawBody: body,
      byteLength: Buffer.byteLength(body),
      headers: new Headers({
        "x-slack-signature": slackSigned(body, stale),
        "x-slack-request-timestamp": String(stale),
      }),
      secret: SECRET,
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, code: "WEBHOOK_TIMESTAMP_REPLAY" });
  });

  it("rejects a tampered Slack body", () => {
    const signed = slackSigned(JSON.stringify({ type: "event_callback" }), now);
    const result = verifyWebhookSignature({
      provider: "slack",
      rawBody: JSON.stringify({ type: "url_verification" }),
      byteLength: 30,
      headers: new Headers({
        "x-slack-signature": signed,
        "x-slack-request-timestamp": String(now),
      }),
      secret: SECRET,
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, code: "WEBHOOK_SIGNATURE_INVALID" });
  });
});

describe("connect webhooks: ACK solo con persistencia (ISA-210)", () => {
  it("answers 503 when no durable event store is available", async () => {
    const body = "{}";
    const response = await webhook(
      request(body, {
        "x-github-delivery": EVENT_ID,
        "x-hub-signature-256": githubSigned(body),
      }),
      "github",
      { store: null, env: env() },
    );
    expect(response.status).toBe(503);
    expect(await readJson(response)).toMatchObject({
      accepted: false,
      error: "WEBHOOK_STORE_UNAVAILABLE",
    });
  });

  it("hashes the raw body deterministically for the event ledger", () => {
    expect(hashWebhookPayload("abc")).toBe(hashWebhookPayload("abc"));
    expect(hashWebhookPayload("abc")).not.toBe(hashWebhookPayload("abd"));
    expect(hashWebhookPayload("abc")).toMatch(/^[0-9a-f]{128}$/);
  });
});

describe("connect webhooks: cola as�ncrona verificada (ISA-207)", () => {
  it("enqueues verified events and runs downstream work out of band", async () => {
    const store = new InMemoryWebhookEventStore();
    const body = JSON.stringify({ action: "opened" });
    const headers = {
      "x-github-delivery": EVENT_ID,
      "x-hub-signature-256": githubSigned(body),
    };

    const response = await webhook(request(body, headers), "github", { store, env: env() });
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ accepted: true, queued: true });

    const seen: string[] = [];
    const firstDrain = await processPendingWebhooks(store, async (event) => {
      seen.push(event.eventId);
    });
    expect(firstDrain).toEqual({ processed: 1, failed: 0 });
    expect(seen).toEqual([EVENT_ID]);

    // El trabajo ya corri�: no se re-procesa sin un evento nuevo.
    const secondDrain = await processPendingWebhooks(store, async () => {
      seen.push("again");
    });
    expect(secondDrain).toEqual({ processed: 0, failed: 0 });
    expect(seen).toEqual([EVENT_ID]);
  });

  it("marks downstream failures without dropping the ledger entry", async () => {
    const store = new InMemoryWebhookEventStore();
    const body = "{}";
    await webhook(
      request(body, {
        "x-github-delivery": EVENT_ID,
        "x-hub-signature-256": githubSigned(body),
      }),
      "github",
      { store, env: env() },
    );

    const result = await processPendingWebhooks(store, async () => {
      throw new Error("downstream connector unavailable");
    });
    expect(result).toEqual({ processed: 0, failed: 1 });

    const pending = await store.takePending(10);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ eventId: EVENT_ID, status: "processing", attempts: 2 });
  });

  it("never re-enqueues a duplicate delivery (ISA-200)", async () => {
    const store = new InMemoryWebhookEventStore();
    const body = "{}";
    const headers = {
      "x-github-delivery": EVENT_ID,
      "x-hub-signature-256": githubSigned(body),
    };
    await webhook(request(body, headers), "github", { store, env: env() });
    const duplicate = await webhook(request(body, headers), "github", { store, env: env() });
    expect(await readJson(duplicate)).toMatchObject({ accepted: true, duplicate: true });

    const drain = await processPendingWebhooks(store, async () => undefined);
    expect(drain).toEqual({ processed: 1, failed: 0 });
    expect(await store.takePending(10)).toHaveLength(0);
  });
});
