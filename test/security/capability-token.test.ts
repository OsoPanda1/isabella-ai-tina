import { beforeEach, describe, expect, it } from "vitest";
import { resetConfigCache } from "@/lib/config";
import { consumeCapabilityToken, issueCapabilityToken } from "@/lib/capability-token";

describe("capability tokens", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = "x".repeat(64);
    process.env.ISABELLA_RUNTIME_MODE = "development";
    resetConfigCache();
  });

  it("binds a token to tool, actor and tenant and is single-use", () => {
    const token = issueCapabilityToken({
      tool: "memory.retrieve",
      actorId: "actor-a",
      tenantId: "tenant-a",
    });
    expect(
      consumeCapabilityToken(token, {
        tool: "memory.retrieve",
        actorId: "actor-a",
        tenantId: "tenant-a",
      }).tool,
    ).toBe("memory.retrieve");
    expect(() =>
      consumeCapabilityToken(token, {
        tool: "memory.retrieve",
        actorId: "actor-a",
        tenantId: "tenant-a",
      }),
    ).toThrow("capability_token_replayed");
  });

  it("rejects scope substitution", () => {
    const token = issueCapabilityToken({
      tool: "memory.retrieve",
      actorId: "actor-a",
      tenantId: "tenant-a",
    });
    expect(() =>
      consumeCapabilityToken(token, {
        tool: "ledger.record",
        actorId: "actor-a",
        tenantId: "tenant-a",
      }),
    ).toThrow("capability_token_scope_mismatch");
  });
});
