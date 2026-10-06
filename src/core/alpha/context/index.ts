/**
 * Alpha — Context
 *
 * Construye el contexto mínimo necesario, no el historial completo.
 * Incluye: sesión, proyecto, territorio, dispositivo, objetivo,
 * restricciones, políticas aplicables.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ContextFrame {
  id: string;
  session: SessionContext;
  project: ProjectContext;
  territory: TerritoryContext;
  device: DeviceContext;
  objective: ObjectiveContext;
  constraints: ConstraintContext;
  applicablePolicies: string[];
  timestamp: string;
}

export interface SessionContext {
  sessionId: string;
  startedAt: string;
  turnCount: number;
  lastActivityAt: string;
  memoryEnabled: boolean;
}

export interface ProjectContext {
  projectId?: string;
  projectName?: string;
  phase?: string;
  participants?: string[];
  status?: "active" | "paused" | "completed";
}

export interface TerritoryContext {
  territoryId?: string;
  territoryName?: string;
  region?: string;
  coordinates?: { lat: number; lng: number };
  timezone?: string;
}

export interface DeviceContext {
  deviceId: string;
  platform: string;
  browser?: string;
  screenResolution?: string;
  connectionType?: string;
  energyLevel?: number;
}

export interface ObjectiveContext {
  primaryGoal: string;
  secondaryGoals: string[];
  successCriteria: string[];
  timeHorizon?: string;
}

export interface ConstraintContext {
  maxLatencyMs?: number | undefined;
  maxCostUsd?: number | undefined;
  maxSteps?: number | undefined;
  maxEnergyJoules?: number | undefined;
  requiredCapabilities: string[];
  forbiddenCapabilities: string[];
}

// ============================================================================
// CONTEXT BUILDER
// ============================================================================

export class ContextBuilder {
  private defaults: Partial<ContextFrame> = {
    session: {
      sessionId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      turnCount: 0,
      lastActivityAt: new Date().toISOString(),
      memoryEnabled: true,
    },
    project: {},
    territory: {
      territoryName: "Mineral del Monte",
      region: "Hidalgo",
      timezone: "America/Mexico_City",
    },
    device: {
      deviceId: "unknown",
      platform: "web",
    },
    objective: {
      primaryGoal: "assist",
      secondaryGoals: [],
      successCriteria: ["user_satisfied", "safe_response"],
    },
    constraints: {
      requiredCapabilities: [],
      forbiddenCapabilities: [],
    },
    applicablePolicies: ["crown_default", "territorial_boundary"],
  };

  /**
   * Build a context frame from partial inputs.
   */
  build(partial: Partial<ContextFrame> & { sessionId?: string }): ContextFrame {
    const now = new Date().toISOString();

    return {
      id: crypto.randomUUID(),
      session: {
        ...this.defaults.session!,
        ...partial.session,
        sessionId:
          partial.sessionId ?? partial.session?.sessionId ?? this.defaults.session!.sessionId,
        lastActivityAt: now,
      },
      project: {
        ...this.defaults.project,
        ...partial.project,
      },
      territory: {
        ...this.defaults.territory,
        ...partial.territory,
      },
      device: {
        ...this.defaults.device!,
        ...partial.device,
      },
      objective: {
        ...this.defaults.objective!,
        ...partial.objective,
      },
      constraints: {
        requiredCapabilities: [],
        forbiddenCapabilities: [],
        ...this.defaults.constraints,
        ...partial.constraints,
      },
      applicablePolicies: partial.applicablePolicies ?? this.defaults.applicablePolicies!,
      timestamp: now,
    };
  }

  /**
   * Merge two context frames, preferring the newer values.
   */
  merge(existing: ContextFrame, updates: Partial<ContextFrame>): ContextFrame {
    return {
      ...existing,
      ...updates,
      session: { ...existing.session, ...updates.session },
      project: { ...existing.project, ...updates.project },
      territory: { ...existing.territory, ...updates.territory },
      device: { ...existing.device, ...updates.device },
      objective: { ...existing.objective, ...updates.objective },
      constraints: { ...existing.constraints, ...updates.constraints },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Extract only the minimal context needed for a given intent.
   */
  extractMinimal(full: ContextFrame, intentCategory: string): Partial<ContextFrame> {
    const minimal: Partial<ContextFrame> = {
      session: {
        ...full.session,
        turnCount: full.session.turnCount,
      },
      territory: full.territory,
      constraints: full.constraints,
    };

    // Add project context only for project-related intents
    if (["creation", "analysis", "command"].includes(intentCategory)) {
      minimal.project = full.project;
    }

    // Add device context only for edge/system intents
    if (["system", "command"].includes(intentCategory)) {
      minimal.device = full.device;
    }

    // Add objective only for research/analysis
    if (["analysis", "research"].includes(intentCategory)) {
      minimal.objective = full.objective;
    }

    return minimal;
  }
}

export const contextBuilder = new ContextBuilder();
