import { describe, expect, it } from "vitest";
import { buildTinaCacheKeySync } from "@/lib/tina/cache";
describe("TINA cache isolation",()=>{
  it("binds cache keys to tenant",()=>{
    const common={principalId:"u",scopes:["read"],prompt:"hola",policyVersion:"v1",knowledgeVersion:"v1",modelVersion:"v1",territoryId:"mx",path:"FAST" as const};
    expect(buildTinaCacheKeySync({tenantId:"a",...common})).not.toBe(buildTinaCacheKeySync({tenantId:"b",...common}));
  });
});
