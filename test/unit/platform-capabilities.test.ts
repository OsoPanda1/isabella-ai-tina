import { describe, expect, it } from "vitest";
import { assertProductionCapability, getCapability } from "@/lib/platform-capabilities";

describe("platform capability production claims", () => {
  it("allows only explicitly production-safe capabilities", () => {
    expect(getCapability("governance.crown")?.productionSafe).toBe(true);
    expect(() => assertProductionCapability("governance.crown")).not.toThrow();
  });

  it("fails closed for implemented capabilities without production evidence", () => {
    for (const id of ["security.aegis-x", "evidence.bookpi", "memory.pentacapa", "tools.sandbox"]) {
      expect(getCapability(id)?.productionSafe).toBe(false);
      expect(() => assertProductionCapability(id)).toThrow(
        /not approved for production execution/i,
      );
    }
  });

  it("never treats simulated or planned capabilities as production-safe", () => {
    expect(() => assertProductionCapability("quantum.bridge")).toThrow();
    expect(() => assertProductionCapability("cryptography.post-quantum-signatures")).toThrow();
    expect(() => assertProductionCapability("federation.external")).toThrow();
  });
});
