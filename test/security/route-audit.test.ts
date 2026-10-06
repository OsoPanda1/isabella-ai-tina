import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

describe("route audit security contract",()=>{
  it("fails when a sensitive route lacks auth/rate-limit/validation signals",()=>{
    const output=execFileSync(process.execPath,["scripts/genesis-route-audit.mjs"],{encoding:"utf8"});
    const report=JSON.parse(output) as { summary:{findings:number}; findings:unknown[] };
    expect(report.summary.findings).toBe(0);
    expect(report.findings).toHaveLength(0);
  });
});
