import { describe, expect, it } from "vitest";
import { createTinaOrchestrator } from "@/lib/tina/orchestrator";
describe("TINA runtime",()=>{
  it("never fabricates execution",async()=>{
    const r=await createTinaOrchestrator().execute({text:"responde una pregunta",complexity:{score:0.2,factualityRequired:0.2},tenantId:"a",principalId:"u"});
    expect(r.execution.executed).toBe(false);
    expect(["ADAPTER_NOT_BOUND","HUMAN_REVIEW_REQUIRED","ETHICAL_BLOCK"]).toContain(r.execution.reason);
  });
  it("forces review for sensitive requests",async()=>{
    const r=await createTinaOrchestrator().execute({text:"operación sensible",complexity:{sensitivity:1,legalImpact:1},tenantId:"a",principalId:"u"});
    expect(r.status).toBe("pending_human_review");
    expect(r.execution.reason).toBe("HUMAN_REVIEW_REQUIRED");
  });
});
