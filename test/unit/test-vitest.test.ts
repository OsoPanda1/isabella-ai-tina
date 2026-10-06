import { test } from "vitest";
test("see what we get", async () => {
  const mod = await import("@/lib/sovereign-audit");
  console.log("KEYS:", Object.keys(mod.SovereignAudit));
  console.log("METHODS:", Object.getOwnPropertyNames(mod.SovereignAudit));
});
