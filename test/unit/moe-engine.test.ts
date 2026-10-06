import { describe, expect, it } from "vitest";
import type { IntelligenceProvider } from "@/lib/intelligence/contracts";
import { createMoERoute, executeMoE } from "@/lib/intelligence/moe-engine";
function provider(modelId:string):IntelligenceProvider {
  return { providerId:`provider-${modelId}`, modelId, capabilities:new Set(["text"]),
    async health(){return true;},
    async invoke(request){return {requestId:request.requestId,modelId,providerId:`provider-${modelId}`,text:`respuesta ${modelId}`,latencyMs:10,degraded:false,risk:"LOW"};}
  };
}
describe("governed MoE engine",()=>{
  it("executes multiple top-k experts",async()=>{
    const providers=new Map([["a",provider("a")],["b",provider("b")],["c",provider("c")]]);
    const descriptors=new Map([["a",{modalities:["text"],enabled:true,productionApproved:true}],["b",{modalities:["text"],enabled:true,productionApproved:true}],["c",{modalities:["text"],enabled:true,productionApproved:true}]]);
    const request={requestId:"r1",tenantId:"t1",actorId:"u1",messages:[{role:"user" as const,content:"hola"}]};
    const result=await executeMoE(request,createMoERoute(request,providers,descriptors,2),providers);
    expect(result.executedExpertCount).toBe(2);
    expect(result.responses).toHaveLength(2);
  });
  it("excludes disabled experts",async()=>{
    const providers=new Map([["a",provider("a")],["b",provider("b")]]);
    const descriptors=new Map([["a",{modalities:["text"],enabled:true,productionApproved:true}],["b",{modalities:["text"],enabled:false,productionApproved:true}]]);
    const request={requestId:"r2",tenantId:"t1",actorId:"u1",messages:[{role:"user" as const,content:"hola"}]};
    const result=await executeMoE(request,createMoERoute(request,providers,descriptors,2),providers);
    expect(result.responses.map((r)=>r.modelId)).toEqual(["a"]);
  });
});
