export interface TerritoryCoordinates {
  latitude: number;
  longitude: number;
  altitudeMeters: number;
  region: string;
  puebloMagicoDesignation: number;
}

export interface TerritorySensorsTelemetry {
  temperatureCelsius: number;
  humidityPercent: number;
  barometricPressureHpa: number;
  mountainFogIndex: "despejado" | "niebla_ligera" | "niebla_densa_serrana";
  nodeMeshLatencyMs: number;
  localEnclaveStatus: "online_sovereign" | "federated" | "degraded";
  dataSovereigntyPercent: number;
}

export interface TerritoryContextSnapshot {
  nodeId: string;
  nodeName: string;
  region: string;
  altitudeMeters: number;
  latitude: number;
  longitude: number;
  coordinates: TerritoryCoordinates;
  telemetry: TerritorySensorsTelemetry;
  historicalEra: string;
  miningHeritageSite: string;
  climateContext: string;
  sovereigntyJurisdiction: string;
  integritySeal: string;
  timestamp: string;
}

class TerritoryContextService {
  private snapshot: TerritoryContextSnapshot = {
    nodeId: "rdm-nodo-cero",
    nodeName: "Nodo Cero · Real del Monte",
    region: "Comarca Minera, Hidalgo, México",
    altitudeMeters: 2710,
    latitude: 20.1417,
    longitude: -98.6728,
    coordinates: {
      latitude: 20.1417,
      longitude: -98.6728,
      altitudeMeters: 2710,
      region: "Comarca Minera, Hidalgo, México",
      puebloMagicoDesignation: 2004,
    },
    telemetry: {
      temperatureCelsius: 14.4,
      humidityPercent: 72,
      barometricPressureHpa: 738,
      mountainFogIndex: "niebla_ligera",
      nodeMeshLatencyMs: 1.8,
      localEnclaveStatus: "online_sovereign",
      dataSovereigntyPercent: 100,
    },
    historicalEra: "Génesis Soberano (Mina de Acosta 1727 · Ecosistema TAMV)",
    miningHeritageSite: "Mina de Acosta & Casa de Máquinas Cornish",
    climateContext: "Bosque de niebla templado de montaña",
    sovereigntyJurisdiction: "Sovereign Genesis FGAIS Constitution v4.3.3",
    integritySeal: "TAMV-RDM-NODO-0-C82F10E4B",
    timestamp: new Date().toISOString(),
  };

  public getSnapshot(): TerritoryContextSnapshot {
    return {
      ...this.snapshot,
      timestamp: new Date().toISOString(),
    };
  }

  public getAltitude(): number {
    return this.snapshot.altitudeMeters;
  }

  public getNodeName(): string {
    return this.snapshot.nodeName;
  }
}

export const territoryContextService = new TerritoryContextService();
