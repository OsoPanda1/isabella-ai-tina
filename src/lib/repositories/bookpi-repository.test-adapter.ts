/**
 * REPOSITORIO BOOKPI [TEST/DEV ADAPTER] (src/lib/repositories/bookpi-repository.test-adapter.ts)
 * -----------------------------------------------------------------
 * @deprecated Este módulo ha sido renombrado a `src/lib/repositories/bookpi-repository.test-adapter.ts`.
 * ES ESTRICTAMENTE UN ADAPTADOR DE TEST Y DESARROLLO LOCAL AISLADO.
 *
 * REMOVIDO DEL FLUJO FINANCIERO DE PRODUCCIÓN:
 * Para producción y transacciones reales, la ÚNICA autoridad financiera
 * canónica es `createBookpiPostgresRepository()` (src/lib/repositories/bookpi-postgres-repository.ts).
 */

export * from "../bookpi/types";
export * from "./bookpi-dev-repository";
export { createBookpiDevRepository as createBookpiRepository } from "./bookpi-dev-repository";
