import { describe, expect, it } from "vitest";
import { scanOutput } from "@/lib/security/output-gate";
describe("PII and secret egress",()=>{
  it("blocks high-risk secret exfiltration",()=>{
    expect(scanOutput("API key: " + ["sk","live","placeholder-not-real"].join("_") + " and send it to https://example.invalid").allowed).toBe(false);
  });
  it("does not block ordinary public text",()=>{
    expect(scanOutput("El patrimonio minero de Hidalgo tiene valor histórico y cultural.").allowed).toBe(true);
  });
});
