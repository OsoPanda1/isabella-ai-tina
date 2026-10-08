/**
 * Science Integrity — Puente Fase B (src/lib/science-integrity/index.ts)
 * ---------------------------------------------------------------------
 * Verificación y Certificación de Integridad Científica sobre los módulos
 * nativos de Isabella: claim-radar, native-ml, ncua, acceleration (Hypercore)
 * e igds. Rutas express en `./routes` (cargadas por server.ts), fuera de este
 * facade para mantener el dominio independiente del framework.
 */
export * from "./contracts";
export * from "./ledger";
export * from "./ingest";
export * from "./claims";
export * from "./classifiers";
export * from "./pipeline";
export * from "./hypercore";
export * from "./review";
export * from "./certification";
export * from "./runtime";