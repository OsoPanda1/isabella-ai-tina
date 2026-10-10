import { describe, it, expect } from "vitest";

/**
 * NODE VM EXECUTOR (test/unit/sandbox-vm.test.ts)
 * -----------------------------------------------------------------
 * Aislamiento real: cómputo correcto, bloqueo de I/O/escape,
 * timeout enforced y truncado de salida.
 */

import { runNodeVmTask } from "@/lib/sandbox/node-vm-executor";

describe("node vm executor", () => {
  it("evalúa expresiones puras", async () => {
    const result = await runNodeVmTask({
      code: "[1,2,3].map(x => x*x).reduce((a,b) => a+b, 0)",
    });
    expect(result.output).toBe("14");
    expect(result.gasTokensConsumed).toBeGreaterThan(0);
  });

  it("expone Math y JSON, nada más", async () => {
    const result = await runNodeVmTask({
      code: "Math.floor(Math.PI * 100) + JSON.stringify({a:1}).length",
    });
    expect(result.output).toBe("321");
  });

  it.each([
    "require('fs')",
    "process.env",
    "fetch('https://x.example')",
    "eval('1')",
    "Function('return 1')",
    "globalThis.foo",
    "import('fs')",
  ])("bloquea %s", async (code) => {
    await expect(runNodeVmTask({ code })).rejects.toThrow();
  });

  it("mata bucles infinitos por timeout", async () => {
    await expect(
      runNodeVmTask({ code: "(() => { while(true) {} })()", timeoutMs: 200 }),
    ).rejects.toThrow(/Timeout/);
  });

  it("deniega runtimes no-JS", async () => {
    await expect(runNodeVmTask({ code: "print(1)", language: "python" })).rejects.toThrow(
      /no soportado/i,
    );
  });

  it("trunca salidas gigantes", async () => {
    const result = await runNodeVmTask({
      code: "'x'.repeat(99999)",
      maxOutputChars: 100,
    });
    expect(result.output.length).toBeLessThanOrEqual(120);
    expect(result.output).toMatch(/truncado/);
  });
});
