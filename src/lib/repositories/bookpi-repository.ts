/**
 * BookPI Repository Interface & Factory (src/lib/repositories/bookpi-repository.ts)
 */
import { BookPiRepository, bookpiPostgresRepository } from "./bookpi-postgres-repository";

export function getBookPiRepository(): BookPiRepository {
  return bookpiPostgresRepository;
}

export { BookPiRepository, bookpiPostgresRepository };
export default bookpiPostgresRepository;


/** Legacy compatibility factory. The historical sync engine intentionally
 * keeps its existing in-memory algorithm; production callers use the
 * explicit createBookpiPostgresRepository() runtime instead. */
export function createBookpiRepository(): BookPiRepository {
  return bookpiPostgresRepository;
}
