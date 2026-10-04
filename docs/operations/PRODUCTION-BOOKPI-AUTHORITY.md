# BookPI — Production Authority

## Canonical production path

Production financial/evidence consumers must resolve:

src/lib/repositories/bookpi-postgres-runtime.ts

This runtime writes to the PostgreSQL table:

bookpi_ledger

The existing legacy implementation in:

src/lib/repositories/bookpi-postgres-repository.ts

is preserved for backward compatibility and development compatibility. It is not the durable production authority.

## Invariants

- PostgreSQL is required for the production runtime.
- No memory fallback is used by createBookpiPostgresRepository().
- Append operations are serialized per tenant with pg_advisory_xact_lock.
- Each block stores previous_hash and a SHA3-512 content hash.
- UPDATE and DELETE remain prohibited by the database append-only trigger.
- Refunds are compensating append-only events; original blocks are never mutated.
- Ledger verification recomputes the full tenant chain.

## Deployment requirement

The BookPI production migration must exist before enabling financial/evidence routes:

supabase/migrations/20260912220000_align_bookpi_runtime_contract.sql

A missing database or failed migration is a deployment blocker, not a condition for silently switching to an in-memory ledger.
