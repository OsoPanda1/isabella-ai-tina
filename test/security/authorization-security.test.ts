import { describe, expect, it } from "vitest";
import { evaluateAuthorization } from "@/lib/authorization";

const request = {
  tenant_id: "tenant-a",
  subject_id: "user-a",
  action: "execute",
  resource: "tool",
  role: "Operator",
  authenticated: true,
  context: {
    ip_address: "127.0.0.1",
    user_agent: "security-test",
    timestamp: new Date(),
  },
};

describe("Authorization security boundaries", () => {
  it.each([
    ["missing tenant", { tenant_id: "" }],
    ["missing subject", { subject_id: "" }],
    ["unknown resource", { resource: "admin" }],
    ["wrong role", { role: "Guest" }],
  ])("denies %s", async (_label, override) => {
    const decision = await evaluateAuthorization({ ...request, ...override });
    expect(decision.allow).toBe(false);
  });

  it("never treats a forged body role as authenticated privilege", async () => {
    const decision = await evaluateAuthorization({ ...request, role: "admin", authenticated: false });
    expect(decision.allow).toBe(false);
  });

  it("produces a signed, time-bounded decision for allowed access", async () => {
    const decision = await evaluateAuthorization(request);
    expect(decision.allow).toBe(true);
    expect(decision.signature.length).toBeGreaterThan(20);
    expect(Date.parse(decision.expires_at)).toBeGreaterThan(Date.parse(decision.issued_at));
  });
});

export {};
