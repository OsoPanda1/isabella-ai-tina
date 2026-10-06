import { describe, it, expect } from "vitest";
import {
  TamvSovereignMonetizationEngine,
  TAMV_SOVEREIGN_PLANS,
} from "../../src/lib/monetization/tamv-monetization";
import {
  CATTLEYA_SPLIT_PERCENTAGES,
  calculateCattleyaSplit,
  commissionForPlan,
} from "../../src/lib/monetization/cattleya";

describe("TAMV Sovereign Monetization Engine & CATTLEYA™ Non-Custodial Model", () => {
  it("Validates canonical CATTLEYA split: 70% creador, 20% plataforma, 5% fondo de respaldo", () => {
    expect(CATTLEYA_SPLIT_PERCENTAGES.creator).toBe(70);
    expect(CATTLEYA_SPLIT_PERCENTAGES.platform).toBe(20);
    expect(CATTLEYA_SPLIT_PERCENTAGES.backupFund).toBe(5);
    expect(CATTLEYA_SPLIT_PERCENTAGES.communityFund).toBe(5);

    const split = calculateCattleyaSplit(200.0);
    expect(split.grossAmountUsd).toBe(200.0);
    expect(split.creatorPct).toBe(70);
    expect(split.creatorUsd).toBe(140.0); // 70%
    expect(split.platformPct).toBe(20);
    expect(split.platformUsd).toBe(40.0); // 20%
    expect(split.backupFundPct).toBe(5);
    expect(split.backupFundUsd).toBe(10.0); // 5% fondo de respaldo
    expect(split.communityFundPct).toBe(5);
    expect(split.communityFundUsd).toBe(10.0); // 5% fondo comunitario
    expect(split.totalRetentionUsd).toBe(60.0); // 30%
  });

  it("Lists all canonical sovereign plans with transparent commission rates", () => {
    const plans = TamvSovereignMonetizationEngine.listPlans();
    expect(plans.length).toBe(4);

    const enterprise = TAMV_SOVEREIGN_PLANS["plan-nodo-cero-enterprise"];
    expect(enterprise.commissionRatePct).toBe(12);
    expect(enterprise.tierName).toBe("CELESTIAL");

    const merchant = TAMV_SOVEREIGN_PLANS["plan-merchant"];
    expect(merchant.commissionRatePct).toBe(15);
  });

  it("Applies transparent commission model without punitive blocking", () => {
    // Standard commission without discount
    const standard = commissionForPlan("plan-merchant");
    expect(standard.rate).toBe(0.15);
    expect(standard.allowed).toBe(true);

    // Commission with positive voluntary loyalty bonus
    const withLoyalty = commissionForPlan("plan-merchant", { loyaltyDiscountPct: 2 });
    expect(withLoyalty.rate).toBe(0.13); // 15% - 2% = 13%
    expect(withLoyalty.allowed).toBe(true);
    expect(withLoyalty.loyaltyDiscountAppliedPct).toBe(2);

    // Unknown plan defaults safely without blocking
    const fallback = commissionForPlan("unknown-plan");
    expect(fallback.rate).toBe(0.2);
    expect(fallback.allowed).toBe(true);
  });

  it("Calculates commerce settlement correctly with Cattleya distribution and non-custodial guarantee", () => {
    const settlement = TamvSovereignMonetizationEngine.calculateCommerceSettlement({
      tenantId: "rdm-tenant-1",
      merchantId: "merchant-paste-real",
      amountUsd: 100.0,
      planId: "plan-merchant",
      reputationScore: 500, // Even with low or zero score, access is guaranteed
      orderRef: "ORD-2026-001",
    });

    expect(settlement.grossAmountUsd).toBe(100.0);
    expect(settlement.commissionRatePct).toBe(15);
    expect(settlement.platformFeeUsd).toBe(15.0);
    expect(settlement.merchantNetUsd).toBe(85.0);
    expect(settlement.cattleyaDistribution.creatorPct).toBe(70);
    expect(settlement.cattleyaDistribution.creatorNetUsd).toBe(70.0);
    expect(settlement.cattleyaDistribution.platformPct).toBe(20);
    expect(settlement.cattleyaDistribution.platformFeeUsd).toBe(20.0);
    expect(settlement.cattleyaDistribution.backupFundPct).toBe(5);
    expect(settlement.cattleyaDistribution.backupFundUsd).toBe(5.0);
    expect(settlement.cattleyaDistribution.communityFundPct).toBe(5);
    expect(settlement.cattleyaDistribution.communityFundUsd).toBe(5.0);
    expect(settlement.receiptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(settlement.fundAccessProtected).toBe(true);
    expect(settlement.nonCustodialGuarantee).toBe("SOVEREIGN_NON_CUSTODIAL_FUNDS_GUARANTEED");
  });

  it("Calculates direct Cattleya settlement via engine helper", () => {
    const direct = TamvSovereignMonetizationEngine.calculateCattleyaSettlement(500.0);
    expect(direct.creatorUsd).toBe(350.0); // 70%
    expect(direct.platformUsd).toBe(100.0); // 20%
    expect(direct.backupFundUsd).toBe(25.0); // 5%
    expect(direct.communityFundUsd).toBe(25.0); // 5%
  });

  it("Guarantees card issuance without arbitrary civic reputation blocking (Protección de fondos)", async () => {
    // User with score < 900 or without score is NOT blocked or denied by reputation
    // It proceeds to provider verification (Stripe), reporting unconfigured when secrets absent in test
    const userLowRep = await TamvSovereignMonetizationEngine.issueCattleyaCard({
      userId: "user-standard",
      tenantId: "rdm-tenant",
      cardholderName: "Comerciante Libre",
      reputationScore: 200,
    });
    // Never denied with CATTLEYA_POLICY_DENY or reputation block
    expect(userLowRep.ok).toBe(false);
    expect((userLowRep as any).reason).toBe("stripe_issuing_unconfigured");

    const userNoRep = await TamvSovereignMonetizationEngine.issueCattleyaCard({
      userId: "user-unrated",
      tenantId: "rdm-tenant",
      cardholderName: "Artesano Real",
      spendingLimitDaily: 500,
    });
    expect(userNoRep.ok).toBe(false);
    expect((userNoRep as any).reason).toBe("stripe_issuing_unconfigured");
  });
});
