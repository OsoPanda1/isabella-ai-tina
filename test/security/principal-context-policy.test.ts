import { describe, expect, it } from "vitest";
import { canUseGuestChat, isExplicitDevelopmentAuth } from "../../src/lib/principal-context";

describe("principal authentication policy", () => {
  it("requires every explicit development flag", () => {
    expect(
      isExplicitDevelopmentAuth({
        NODE_ENV: "development",
        ISABELLA_RUNTIME_MODE: "development",
        AUTH_DEV_SESSION_ENABLED: true,
      }),
    ).toBe(true);

    expect(
      isExplicitDevelopmentAuth({
        NODE_ENV: "development",
        ISABELLA_RUNTIME_MODE: "staging",
        AUTH_DEV_SESSION_ENABLED: true,
      }),
    ).toBe(false);
    expect(
      isExplicitDevelopmentAuth({
        NODE_ENV: "production",
        ISABELLA_RUNTIME_MODE: "development",
        AUTH_DEV_SESSION_ENABLED: true,
      }),
    ).toBe(false);
  });

  it("never enables guest chat from NODE_ENV alone", () => {
    expect(canUseGuestChat({ NODE_ENV: "development" })).toBe(false);
    expect(
      canUseGuestChat({
        NODE_ENV: "production",
        ISABELLA_RUNTIME_MODE: "production",
        ALLOW_GUEST_CHAT: true,
      }),
    ).toBe(false);
  });

  it("allows guest chat only when explicitly enabled in development", () => {
    expect(
      canUseGuestChat({
        NODE_ENV: "development",
        ISABELLA_RUNTIME_MODE: "development",
        ALLOW_GUEST_CHAT: true,
      }),
    ).toBe(true);
  });
});
