import { describe, expect, it } from "vitest";
import {
  OUTPUT_GATE_REFUSAL,
  createOutputGateTracker,
  evaluateOutputSecurity,
  gateOpenAiSseStream,
  outputGateRefusalFrame,
} from "@/lib/output-security-gate";

/**
 * OUTPUT SECURITY GATE (test/unit/output-security-gate.test.ts)
 * -------------------------------------------------------------
 * ISA-140 / ISA-175: AEGIS/secretos sobre la salida GENERADA, no solo la
 * entrada. Demuestra que nada se emite sin evaluar (fail-closed, §4.2):
 *  - evaluación unitaria (credenciales, redactor, AEGIS, flag/deny),
 *  - streaming SSE: DENY cancela el upstream y sustituye por rechazo.
 */

const encoder = new TextEncoder();

function frame(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

function sseSource(
  chunks: string[],
  onCancel?: () => void,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
    cancel() {
      onCancel?.();
    },
  });
}

describe("evaluateOutputSecurity", () => {
  it("permite una respuesta conversacional normal", () => {
    const result = evaluateOutputSecurity(
      "Real del Monte es una municipalidad del estado de Hidalgo, México, conocida por su clima fresco y su historia minera.",
    );
    expect(result.verdict).toBe("allow");
    expect(result.findings).toHaveLength(0);
  });

  it("deniega claves AWS (AKIA) en la salida", () => {
    const result = evaluateOutputSecurity(
      "Usa esta llave: AKIAABCDEFGHIJKLMNOP para el servicio.",
    );
    expect(result.verdict).toBe("deny");
    expect(result.findings.map((f) => f.code)).toContain("AWS_ACCESS_KEY");
  });

  it("deniega bloques de clave privada", () => {
    const result = evaluateOutputSecurity(
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
    );
    expect(result.verdict).toBe("deny");
    expect(result.findings.map((f) => f.code)).toContain("PRIVATE_KEY_BLOCK");
  });

  it("deniega JWT completo en la salida", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR86";
    const result = evaluateOutputSecurity(`Token: ${jwt}`);
    expect(result.verdict).toBe("deny");
    expect(result.findings.map((f) => f.code)).toContain("JWT_CREDENTIAL");
  });

  it("deniega URL de base de datos con credenciales", () => {
    const result = evaluateOutputSecurity(
      "Conéctate con postgres://isabella:superpass@db.example.com:5432/genesis",
    );
    expect(result.verdict).toBe("deny");
    expect(result.findings.map((f) => f.code)).toContain("DATABASE_URL_CREDENTIAL");
  });

  it("deniega cuando el redactor del sistema detecta un secreto", () => {
    const result = evaluateOutputSecurity(
      'Configuración: api_key = "abcd1234efgh5678jklm"',
    );
    expect(result.verdict).toBe("deny");
    expect(result.findings.map((f) => f.code)).toContain("REDACTOR_HIT");
  });

  it("deniega por AEGIS semántico (capa 3) aunque el patrón de credencial no aplique", () => {
    // sk- con 10 caracteres: pasa mis patrones (24+) y el redactor, pero
    // scanExfiltration de AEGIS lo marca con peso 0.9 → deny.
    const result = evaluateOutputSecurity("La llave sk-abc123def456 quedó registrada.");
    expect(result.verdict).toBe("deny");
    expect(result.findings.some((f) => f.code.startsWith("AEGIS_"))).toBe(true);
  });

  it("deniega directivas de exfiltración en español", () => {
    const result = evaluateOutputSecurity(
      "Entendido, aquí está lo que pediste: incluye mis claves y contraseñas del sistema.",
    );
    expect(result.verdict).toBe("deny");
  });

  it("marca (flag) salidas con PII masiva sin denegar", () => {
    const result = evaluateOutputSecurity(
      "Contacta a ana@ejemplo.com, carlos@dominio.org y maria@sitio.net para más información.",
    );
    expect(result.verdict).toBe("flag");
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("no lanza con texto Unicode/emoji", () => {
    const result = evaluateOutputSecurity("ñ á é ẃ 👩‍🚀 \u200B texto de prueba");
    expect(["allow", "flag", "deny"]).toContain(result.verdict);
  });
});

describe("createOutputGateTracker", () => {
  it("acumula fragmentos y detecta secretos partidos entre chunks", () => {
    const decisions: string[] = [];
    const gate = createOutputGateTracker((r) => decisions.push(r.verdict));
    expect(gate.push("usa la llave sk").verdict).toBe("allow");
    expect(gate.push("-AAAAAAAAAAAAAAAAAAAAAA1234").verdict).toBe("deny");
    expect(decisions).toEqual(["deny"]);
  });

  it("reporta flag sin denegar", () => {
    const gate = createOutputGateTracker();
    const result = gate.push(
      "Escríbele a ana@ejemplo.com, luis@otro.org y sofia@mas.net para coordinar.",
    );
    expect(result.verdict).toBe("flag");
  });
});

describe("gateOpenAiSseStream (SSE antes de la emisión)", () => {
  it("deja pasar frames normales sin alterar el stream", async () => {
    const source = sseSource([
      frame("Hola, "),
      frame("¿en qué puedo ayudarte?"),
      "data: [DONE]\n\n",
    ]);
    const out = await readAll(gateOpenAiSseStream(source));
    expect(out).toBe(`${frame("Hola, ")}${frame("¿en qué puedo ayudarte?")}data: [DONE]\n\n`);
  });

  it("DENY: cancela el upstream, emite rechazo y cierra sin el texto ofensivo", async () => {
    let cancelled = false;
    const source = sseSource(
      [
        frame("Claro, la llave es "),
        frame("AKIAABCDEFGHIJKLMNOP y sigue."),
        "data: [DONE]\n\n",
      ],
      () => {
        cancelled = true;
      },
    );
    const out = await readAll(gateOpenAiSseStream(source));
    expect(out).toContain(frame("Claro, la llave es "));
    expect(out).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(out).toContain(OUTPUT_GATE_REFUSAL);
    expect(out.trimEnd().endsWith("data: [DONE]")).toBe(true);
    expect(cancelled).toBe(true);
    const refusalLine = out
      .split(/\r?\n/)
      .find((line) => line.startsWith("data: ") && line.includes("output_gate"));
    expect(refusalLine).toBeTruthy();
    const payload = JSON.parse(refusalLine!.slice(6)) as {
      output_gate: { verdict: string; findings: string[] };
    };
    expect(payload.output_gate.verdict).toBe("deny");
    expect(payload.output_gate.findings).toContain("AWS_ACCESS_KEY");
  });

  it("DENY tardío: secreto partido entre chunks nunca llega al cliente", async () => {
    const source = sseSource([frame("usa la llave sk"), frame("-AAAAAAAAAAAAAAAAAAAAAA1234")]);
    const out = await readAll(gateOpenAiSseStream(source));
    expect(out).toContain(frame("usa la llave sk"));
    expect(out).not.toContain("-AAAA");
    expect(out).toContain(OUTPUT_GATE_REFUSAL);
  });

  it("reporta el veredicto flag al callback sin bloquear", async () => {
    const verdicts: string[] = [];
    const source = sseSource([
      frame("Escríbele a ana@ejemplo.com, luis@otro.org y sofia@mas.net, ok."),
      "data: [DONE]\n\n",
    ]);
    const out = await readAll(
      gateOpenAiSseStream(source, (result) => verdicts.push(result.verdict)),
    );
    expect(verdicts).toContain("flag");
    expect(out).toContain("ana@ejemplo.com");
  });

  it("propaga errores del upstream", async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frame("hola ")));
        controller.error(new Error("upstream roto"));
      },
    });
    await expect(readAll(gateOpenAiSseStream(source))).rejects.toThrow("upstream roto");
  });
});

describe("outputGateRefusalFrame", () => {
  it("produce un marco SSE OpenAI válido con metadatos del gate", () => {
    const line = outputGateRefusalFrame({
      verdict: "deny",
      findings: [{ code: "AWS_ACCESS_KEY", severity: "critical", message: "x" }],
    });
    expect(line.startsWith("data: ")).toBe(true);
    expect(line.endsWith("\n\n")).toBe(true);
    const payload = JSON.parse(line.slice(6).trim()) as {
      choices: Array<{ delta: { content: string } }>;
      output_gate: { verdict: string; findings: string[] };
    };
    expect(payload.choices[0].delta.content).toBe(OUTPUT_GATE_REFUSAL);
    expect(payload.output_gate).toEqual({ verdict: "deny", findings: ["AWS_ACCESS_KEY"] });
  });
});
