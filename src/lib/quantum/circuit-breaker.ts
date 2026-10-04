/**
 * Isabella Quantum Mesh — Circuit Breaker (Resiliencia por proveedor)
 * Cada proveedor tiene su propio circuito. Un proveedor caído no afecta a toda la plataforma.
 * Estados: CLOSED → OPEN → HALF_OPEN → CLOSED
 */

interface CircuitState {
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  failures: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  consecutiveSuccesses: number;
}

const DEFAULT_THRESHOLD = 5;
const DEFAULT_RESET_TIMEOUT_MS = 30_000;
const DEFAULT_HALF_OPEN_MAX = 2;

const circuits = new Map<string, CircuitState>();

function getCircuit(provider: string): CircuitState {
  let circuit = circuits.get(provider);
  if (!circuit) {
    circuit = {
      state: "CLOSED",
      failures: 0,
      lastFailureTime: 0,
      lastSuccessTime: Date.now(),
      consecutiveSuccesses: 0,
    };
    circuits.set(provider, circuit);
  }
  return circuit;
}

/**
 * Verifica si un provider puede recibir tráfico.
 */
export function canExecute(provider: string): {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
} {
  const circuit = getCircuit(provider);

  if (circuit.state === "CLOSED") {
    return { allowed: true };
  }

  if (circuit.state === "OPEN") {
    const elapsed = Date.now() - circuit.lastFailureTime;
    if (elapsed > DEFAULT_RESET_TIMEOUT_MS) {
      circuit.state = "HALF_OPEN";
      circuit.consecutiveSuccesses = 0;
      return { allowed: true, reason: "HALF_OPEN_PROBE" };
    }
    return {
      allowed: false,
      reason: "CIRCUIT_OPEN",
      retryAfterMs: DEFAULT_RESET_TIMEOUT_MS - elapsed,
    };
  }

  // HALF_OPEN: allow limited traffic
  if (circuit.consecutiveSuccesses < DEFAULT_HALF_OPEN_MAX) {
    return { allowed: true, reason: "HALF_OPEN_PROBE" };
  }
  return { allowed: false, reason: "HALF_OPEN_LIMIT" };
}

/**
 * Registra una falla del provider.
 */
export function recordFailure(provider: string): CircuitState {
  const circuit = getCircuit(provider);
  circuit.failures++;
  circuit.lastFailureTime = Date.now();
  circuit.consecutiveSuccesses = 0;

  if (circuit.failures >= DEFAULT_THRESHOLD) {
    circuit.state = "OPEN";
  }

  return { ...circuit };
}

/**
 * Registra un éxito del provider.
 */
export function recordSuccess(provider: string): CircuitState {
  const circuit = getCircuit(provider);
  circuit.lastSuccessTime = Date.now();
  circuit.consecutiveSuccesses++;

  if (circuit.state === "HALF_OPEN" && circuit.consecutiveSuccesses >= DEFAULT_HALF_OPEN_MAX) {
    circuit.state = "CLOSED";
    circuit.failures = 0;
  } else if (circuit.state === "OPEN") {
    // shouldn't happen, but reset if somehow called
    circuit.state = "HALF_OPEN";
    circuit.consecutiveSuccesses = 1;
  }

  return { ...circuit };
}

/**
 * Resetea manualmente el circuito de un provider.
 */
export function resetCircuit(provider: string): void {
  circuits.set(provider, {
    state: "CLOSED",
    failures: 0,
    lastFailureTime: 0,
    lastSuccessTime: Date.now(),
    consecutiveSuccesses: 0,
  });
}

/**
 * Estado de todos los circuitos.
 */
export function getCircuitStatus(): Record<string, CircuitState> {
  const result: Record<string, CircuitState> = {};
  for (const [provider, state] of circuits) {
    result[provider] = { ...state };
  }
  return result;
}

/**
 * Métricas globales del circuit breaker.
 */
export function getCircuitBreakerMetrics() {
  const all = Array.from(circuits.values());
  return {
    totalCircuits: all.length,
    open: all.filter((c) => c.state === "OPEN").length,
    halfOpen: all.filter((c) => c.state === "HALF_OPEN").length,
    closed: all.filter((c) => c.state === "CLOSED").length,
    totalFailures: all.reduce((sum, c) => sum + c.failures, 0),
  };
}
