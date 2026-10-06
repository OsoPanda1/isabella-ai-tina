import { describe, expect, it } from "vitest";
import { hasBillingAuthorization } from "@/lib/billing-authorization";

describe("billing least privilege", () => {
  it("requires dedicated scope for topups", () => {
    expect(
      hasBillingAuthorization({
        operation: "topup",
        role: "SovereignOwner",
        scopes: ["system:write"],
        stepUpVerified: true,
      }),
    ).toBe(false);
    expect(
      hasBillingAuthorization({
        operation: "topup",
        role: "SovereignOwner",
        scopes: ["billing:topup"],
        stepUpVerified: true,
      }),
    ).toBe(true);
  });

  it("requires step-up for refunds and manual credits", () => {
    expect(
      hasBillingAuthorization({
        operation: "refund",
        role: "SovereignOwner",
        scopes: ["billing:refund"],
        stepUpVerified: false,
      }),
    ).toBe(false);
    expect(
      hasBillingAuthorization({
        operation: "refund",
        role: "SovereignOwner",
        scopes: ["billing:refund"],
        stepUpVerified: true,
      }),
    ).toBe(true);
    expect(
      hasBillingAuthorization({
        operation: "topup",
        role: "Operator",
        scopes: ["billing:topup"],
        stepUpVerified: true,
      }),
    ).toBe(false);
  });
});
