/** TINA BookPI hash-chain ledger (src/lib/tina/ledger.ts).
 * This class is intentionally an in-memory test/development adapter.
 * Production audit must use the durable BookPI/decision repository.
 */
import { sha256Hex } from "./ethical";

export interface TinaBookEvent {
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
  hash: string;
  previousHash: string | null;
}

function canonicalBody(
  event: Pick<TinaBookEvent, "type" | "timestamp" | "payload" | "previousHash">,
): string {
  return JSON.stringify({
    type: event.type,
    timestamp: event.timestamp,
    payload: event.payload,
    previousHash: event.previousHash,
  });
}

export class TinaBookPI {
  private events: TinaBookEvent[] = [];

  async append(type: string, payload: Record<string, unknown>): Promise<TinaBookEvent> {
    const previousHash = this.events.at(-1)?.hash ?? null;
    const timestamp = new Date().toISOString();
    const hash = sha256Hex(canonicalBody({ type, timestamp, payload, previousHash }));
    const event: TinaBookEvent = { type, timestamp, payload, hash, previousHash };
    this.events.push(event);
    return event;
  }

  list(): readonly TinaBookEvent[] {
    return this.events.map((event) => ({
      ...event,
      payload: { ...event.payload },
    }));
  }

  last(): TinaBookEvent | undefined {
    const event = this.events.at(-1);
    return event ? { ...event, payload: { ...event.payload } } : undefined;
  }

  verifyChain(): boolean {
    let previousHash: string | null = null;
    for (const event of this.events) {
      if (event.previousHash !== previousHash) return false;
      const expected = sha256Hex(canonicalBody(event));
      if (expected !== event.hash) return false;
      previousHash = event.hash;
    }
    return true;
  }
}
