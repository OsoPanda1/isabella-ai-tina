import { z } from "zod";

// ZNE: Zero-Noise Extrapolation
export const ZneConfigurationSchema = z.object({
  level: z.literal(3).describe("QUP v3.0 requires strictly ZNE level 3 for sovereign operations"),
  extrapolationMethod: z.enum(["linear", "richardson", "exponential"]),
  scaleFactors: z.array(z.number()).min(3, "At least 3 scale factors required for ZNE Level 3"),
});

// PEC: Probabilistic Error Cancellation
export const PecConfigurationSchema = z.object({
  enabled: z.boolean(),
  samplingOverhead: z.number().min(1.0, "Sampling overhead must be >= 1.0"),
  learningPhaseFidelity: z.number().min(0.99, "Minimum 99% fidelity required in learning phase"),
});

// QEC: Quantum Error Correction
export const QecConfigurationSchema = z.object({
  codeType: z.enum(["surface", "color", "steane"]),
  distance: z.number().min(3).int(),
  decoder: z
    .enum(["mwpm", "uf", "tensor-network", "neural-network"])
    .describe("Minimum Weight Perfect Matching, Union-Find, etc."),
  logicalQubits: z.number().int().min(1),
});

// Sovereign Runtime Configuration for QUP v3.0
export const SovereignQuantumRuntimeSchema = z.object({
  backend: z.string().min(1),
  zne: ZneConfigurationSchema,
  pec: PecConfigurationSchema,
  qec: QecConfigurationSchema,
  maxExecutionTimeMs: z
    .number()
    .max(60000, "Max execution time cannot exceed 60 seconds for sovereign nodes"),
  territorialNode: z.string(),
  strictIsolation: z.literal(true),
});

export type ZneConfiguration = z.infer<typeof ZneConfigurationSchema>;
export type PecConfiguration = z.infer<typeof PecConfigurationSchema>;
export type QecConfiguration = z.infer<typeof QecConfigurationSchema>;
export type SovereignQuantumRuntime = z.infer<typeof SovereignQuantumRuntimeSchema>;
