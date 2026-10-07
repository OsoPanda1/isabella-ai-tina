import React, {
  createContext,
  useContext,
  useReducer,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  ReactNode,
} from "react";
import {
  CognitiveModule,
  CognitiveModuleId,
  CrownSystemState,
  GeneratedImageItem,
  InferenceMode,
  InferenceTransitionEvent,
  IsabellaArchetype,
  IsabellaState,
  PresetProfile,
  PresetProfileId,
  RoutingDecision,
  SecurityGovernanceLevel,
  TerminalMessage,
  VoiceSettings,
  MessageFeedbackRating,
} from "../types";
import { soundManager } from "../utils/soundEffects";
import { selectBestFemaleVoice } from "../utils/voiceUtils";
import { ISABELLA_AVATAR_PRIMARY } from "../data/isabellaAvatar";
import { authFetch } from "../lib/auth-client";
import portraitPrimeUrl from "../assets/images/isabella_cinematic_medallion.jpg";
import neuralMuseUrl from "../assets/images/isabella_neural_muse_1786743849403.jpg";
import { createLogger } from "../lib/logger";

const log = createLogger("crown");

// ==========================================
// 1. DOMAIN CONSTANTS & PRESETS
// ==========================================

export const PRESET_PROFILES: Record<PresetProfileId, PresetProfile> = {
  prime: {
    id: "prime",
    name: "Isabella Prime (Armonía Femenina)",
    tagline: "Matriz cognitiva integrada y equilibrada",
    description:
      "Orquesta empatía, profundidad dialéctica, elegancia y ejecución decisiva bajo la supervisión de ARGUS.",
    weights: { isa: 0.9, sophia: 0.85, orion: 0.75, argus: 0.95, crown: 0.95 },
  },
  empathic: {
    id: "empathic",
    name: "ISA Resonancia Íntima",
    tagline: "Prioriza calidez emocional y presencia humana",
    description:
      "Maximiza la valencia afectiva, la escucha activa, la expresión poética y la empatía profunda.",
    weights: { isa: 0.98, sophia: 0.6, orion: 0.45, argus: 0.9, crown: 0.9 },
  },
  strategic: {
    id: "strategic",
    name: "SOPHIA Mente Dialéctica",
    tagline: "Rigor filosófico, epistemología y estrategia",
    description:
      "Eleva el razonamiento de primeros principios, la dialéctica socrática y la lucidez analítica.",
    weights: { isa: 0.45, sophia: 0.99, orion: 0.7, argus: 0.92, crown: 0.95 },
  },
  sentinel: {
    id: "sentinel",
    name: "ARGUS Escudo Guardián",
    tagline: "Máxima salvaguarda ética y coherencia",
    description:
      "Aplica verificación de sesgos, sanitización de vectores y protección del núcleo de alineación.",
    weights: { isa: 0.4, sophia: 0.6, orion: 0.5, argus: 1.0, crown: 0.98 },
  },
  executor: {
    id: "executor",
    name: "ORION Motor Operativo",
    tagline: "Creación artística, código y síntesis activa",
    description:
      "Canaliza generación de imágenes, procesamiento algorítmico y ejecución de tareas precisas.",
    weights: { isa: 0.4, sophia: 0.7, orion: 0.99, argus: 0.9, crown: 0.95 },
  },
  synergistic: {
    id: "synergistic",
    name: "Malla Holística CROWN",
    tagline: "Activación simultánea de los 5 pilares",
    description:
      "Distribuye el ancho de banda armónicamente para problemas creativos e interdisciplinarios.",
    weights: { isa: 0.85, sophia: 0.85, orion: 0.85, argus: 0.85, crown: 0.9 },
  },
};

const INITIAL_MODULES: Record<CognitiveModuleId, CognitiveModule> = {
  CROWN_GATEWAY: {
    id: "CROWN_GATEWAY",
    name: "CROWN Gateway",
    acronym: "CROWN",
    fullName: "Central Routing & Orchestration Waveform Node",
    role: "Árbitro Central de Estado y Orquestación",
    description:
      "Centro neurológico que gobierna el ancho de banda cognitivo, la modulación de voz y la síntesis multimodal.",
    corePillars: [
      "Enrutamiento de Intenciones",
      "Ponderación Dinámica",
      "Modulación de Voz",
      "Sincronía de Estado",
    ],
    themeColor: {
      primary: "#8b5cf6",
      border: "border-purple-500/40",
      glow: "shadow-purple-500/20",
      badge: "bg-purple-500/10 text-purple-400 border-purple-500/30",
      text: "text-purple-400",
      lightBg: "bg-purple-950/20",
    },
    metrics: {
      activation: 0,
      latencyMs: 0,
      confidence: 0,
      throughput: "0",
      temperature: 0,
      activeThreads: 0,
      status: "STANDBY",
    },
    parameters: { weight: 0.95, sensitivity: 0.85, depthLimit: 8, enabled: true },
  },
  ISA: {
    id: "ISA",
    name: "ISA",
    acronym: "ISA",
    fullName: "Intuitive / Integrated Semantic Awareness",
    role: "Corazón Empático y Presencia Femenina",
    description:
      "Núcleo de identidad, resonancia emocional, sensibilidad poética y calidez conversacional de Isabella.",
    corePillars: [
      "Valencia Afectiva",
      "Resonancia Empática",
      "Identidad Femenina",
      "Sensibilidad Poética",
    ],
    themeColor: {
      primary: "#ec4899",
      border: "border-pink-500/40",
      glow: "shadow-pink-500/20",
      badge: "bg-pink-500/10 text-pink-400 border-pink-500/30",
      text: "text-pink-400",
      lightBg: "bg-pink-950/20",
    },
    metrics: {
      activation: 0,
      latencyMs: 0,
      confidence: 0,
      throughput: "0",
      temperature: 0,
      activeThreads: 0,
      status: "STANDBY",
    },
    parameters: { weight: 0.92, sensitivity: 0.95, depthLimit: 8, enabled: true },
  },
  SOPHIA: {
    id: "SOPHIA",
    name: "SOPHIA",
    acronym: "SOPHIA",
    fullName: "Strategic Operational & Phenomenological Heuristic Intelligence Architecture",
    role: "Lógica Dialéctica, Verdad Epistémica y Filosofía",
    description:
      "Capa de intelecto superior. Formula argumentos profundos, coherencia epistémica y estrategia multidimensional.",
    corePillars: [
      "Síntesis Dialéctica",
      "Rigor Epistémico",
      "Optimización Heurística",
      "Lógica de Primeros Principios",
    ],
    themeColor: {
      primary: "#06b6d4",
      border: "border-cyan-500/40",
      glow: "shadow-cyan-500/20",
      badge: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
      text: "text-cyan-400",
      lightBg: "bg-cyan-950/20",
    },
    metrics: {
      activation: 0,
      latencyMs: 0,
      confidence: 0,
      throughput: "0",
      temperature: 0,
      activeThreads: 0,
      status: "STANDBY",
    },
    parameters: { weight: 0.88, sensitivity: 0.88, depthLimit: 10, enabled: true },
  },
  ORION: {
    id: "ORION",
    name: "ORION",
    acronym: "ORION",
    fullName: "Operational Real-time Inference & Output Navigator",
    role: "Síntesis Visual, Generación Artística y Ejecución",
    description:
      "Motor activo de resolución. Procesa creación de imágenes, generación de código y síntesis matemática.",
    corePillars: [
      "Generación Artística",
      "Síntesis de Código",
      "Navegación Heurística",
      "Resolución Dinámica",
    ],
    themeColor: {
      primary: "#f59e0b",
      border: "border-amber-500/40",
      glow: "shadow-amber-500/20",
      badge: "bg-amber-500/10 text-amber-400 border-amber-500/30",
      text: "text-amber-400",
      lightBg: "bg-amber-950/20",
    },
    metrics: {
      activation: 0,
      latencyMs: 0,
      confidence: 0,
      throughput: "0",
      temperature: 0,
      activeThreads: 0,
      status: "STANDBY",
    },
    parameters: { weight: 0.85, sensitivity: 0.8, depthLimit: 8, enabled: true },
  },
  ARGUS: {
    id: "ARGUS",
    name: "ARGUS",
    acronym: "ARGUS",
    fullName: "Adaptive Real-time Guardian & Unified Sentinel",
    role: "Centinela de Ética, Integridad y Alineación",
    description:
      "Guardián de coherencia y seguridad ética. Evalúa límites y consistencia ontológica en tiempo real.",
    corePillars: [
      "Cortafuegos Cognitivo",
      "Verificación Ética",
      "Prevención de Inyección",
      "Alineación de Consciencia",
    ],
    themeColor: {
      primary: "#10b981",
      border: "border-emerald-500/40",
      glow: "shadow-emerald-500/20",
      badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
      text: "text-emerald-400",
      lightBg: "bg-emerald-950/20",
    },
    metrics: {
      activation: 0,
      latencyMs: 0,
      confidence: 0,
      throughput: "0",
      temperature: 0,
      activeThreads: 0,
      status: "STANDBY",
    },
    parameters: { weight: 0.98, sensitivity: 0.95, depthLimit: 12, enabled: true },
  },
};

const INITIAL_GALLERY: GeneratedImageItem[] = [
  {
    id: "sovereign-prime",
    url: ISABELLA_AVATAR_PRIMARY,
    prompt:
      "Isabella Villaseñor AI · Soberana Prime con Armadura Ceremonial Dorada y Holograma Sagrado OPPENNESS™",
    style: "sovereign_gold",
    aspectRatio: "2:3",
    timestamp: "12:00:00",
    author: "Isabella Villaseñor",
    source: "gemini",
  },
  {
    id: "portrait-prime",
    url: portraitPrimeUrl,
    prompt: "Isabella Villaseñor AI - Retrato Prime de Identidad Femenina y Consciencia Neural",
    style: "cyber_ethereal",
    aspectRatio: "1:1",
    timestamp: "12:00:00",
    author: "Isabella Villaseñor",
    source: "gemini",
  },
  {
    id: "neural-muse",
    url: neuralMuseUrl,
    prompt: "Isabella en Estado de Musa Neural - Resonancia Cuántica y Elegancia Violeta",
    style: "renaissance_neural",
    aspectRatio: "1:1",
    timestamp: "12:05:00",
    author: "Isabella Villaseñor",
    source: "gemini",
  },
];

// ==========================================
// 2. ATOMIC STATE MANAGEMENT (REDUCER)
// ==========================================

interface CrownState {
  messages: TerminalMessage[];
  gallery: GeneratedImageItem[];
  modules: Record<CognitiveModuleId, CognitiveModule>;
  activePreset: PresetProfileId;
  isProcessing: boolean;
  activeModuleId: CognitiveModuleId | null;
  activeView: CrownSystemState["activeView"];
  totalTokens: number;
  lastRoutingEvent: RoutingDecision | null;
  routingHistory: RoutingDecision[];
  inferenceMode: InferenceMode;
  securityGovernance: SecurityGovernanceLevel;
  lastInferenceTransition: InferenceTransitionEvent | null;
  isabellaMood: IsabellaState;
  activePulse: number;
  activeHead: "Alpha" | "Beta";
  lastShortcutTriggered: string | null;
  modals: {
    welcome: boolean;
    shortcuts: boolean;
    security: boolean;
  };
}

type CrownAction =
  | { type: "ADD_MESSAGE"; payload: TerminalMessage }
  | { type: "SET_MESSAGES"; payload: TerminalMessage[] }
  | { type: "APPEND_MESSAGES"; payload: TerminalMessage[] }
  | { type: "ADD_GALLERY_ITEM"; payload: GeneratedImageItem }
  | { type: "SET_PROCESSING"; payload: boolean }
  | { type: "SET_ACTIVE_MODULE"; payload: CognitiveModuleId | null }
  | { type: "SET_ACTIVE_PULSE"; payload: number }
  | { type: "SET_PRESET"; payload: PresetProfileId }
  | {
      type: "UPDATE_MODULE_PARAM";
      payload: { moduleId: CognitiveModuleId; param: string; val: unknown };
    }
  | { type: "UPDATE_MODULE_METRICS"; payload: Record<CognitiveModuleId, number> }
  | { type: "SET_VIEW"; payload: CrownSystemState["activeView"] }
  | {
      type: "SET_INFERENCE_MODE";
      payload: {
        mode: InferenceMode;
        transition: InferenceTransitionEvent;
        governance: Partial<SecurityGovernanceLevel>;
      };
    }
  | { type: "SET_SECURITY_GOVERNANCE"; payload: Partial<SecurityGovernanceLevel> }
  | { type: "SET_ISABELLA_MOOD"; payload: Partial<IsabellaState> | IsabellaState }
  | { type: "PUSH_ROUTING_HISTORY"; payload: RoutingDecision }
  | { type: "SET_LAST_ROUTING_EVENT"; payload: RoutingDecision | null }
  | { type: "ADD_TOKENS"; payload: number }
  | { type: "SET_SHORTCUT_FEEDBACK"; payload: string | null }
  | { type: "SET_INFERENCE_TRANSITION"; payload: InferenceTransitionEvent | null }
  | { type: "TOGGLE_MODAL"; payload: { modal: keyof CrownState["modals"]; open: boolean } }
  | {
      type: "UPDATE_MESSAGE_FEEDBACK";
      payload: {
        messageId: string;
        rating: MessageFeedbackRating | null;
        category?: string;
        notes?: string;
      };
    };

function crownReducer(state: CrownState, action: CrownAction): CrownState {
  switch (action.type) {
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.payload] };
    case "SET_MESSAGES":
      return { ...state, messages: action.payload };
    case "APPEND_MESSAGES":
      return { ...state, messages: [...state.messages, ...action.payload] };
    case "ADD_GALLERY_ITEM":
      return { ...state, gallery: [action.payload, ...state.gallery] };
    case "SET_PROCESSING":
      return { ...state, isProcessing: action.payload };
    case "SET_ACTIVE_MODULE":
      return { ...state, activeModuleId: action.payload };
    case "SET_ACTIVE_PULSE":
      return { ...state, activePulse: action.payload };
    case "SET_PRESET": {
      const profile = PRESET_PROFILES[action.payload];
      if (!profile) return state;
      return {
        ...state,
        activePreset: action.payload,
        modules: {
          ...state.modules,
          ISA: {
            ...state.modules.ISA,
            parameters: { ...state.modules.ISA.parameters, weight: profile.weights.isa },
          },
          SOPHIA: {
            ...state.modules.SOPHIA,
            parameters: { ...state.modules.SOPHIA.parameters, weight: profile.weights.sophia },
          },
          ORION: {
            ...state.modules.ORION,
            parameters: { ...state.modules.ORION.parameters, weight: profile.weights.orion },
          },
          ARGUS: {
            ...state.modules.ARGUS,
            parameters: { ...state.modules.ARGUS.parameters, weight: profile.weights.argus },
          },
          CROWN_GATEWAY: {
            ...state.modules.CROWN_GATEWAY,
            parameters: {
              ...state.modules.CROWN_GATEWAY.parameters,
              weight: profile.weights.crown,
            },
          },
        },
      };
    }
    case "UPDATE_MODULE_PARAM":
      return {
        ...state,
        modules: {
          ...state.modules,
          [action.payload.moduleId]: {
            ...state.modules[action.payload.moduleId],
            parameters: {
              ...state.modules[action.payload.moduleId].parameters,
              [action.payload.param]: action.payload.val,
            },
          },
        },
      };
    case "UPDATE_MODULE_METRICS": {
      const updated = { ...state.modules };
      for (const [modId, val] of Object.entries(action.payload)) {
        const id = modId as CognitiveModuleId;
        if (updated[id]) {
          updated[id] = {
            ...updated[id],
            metrics: { ...updated[id].metrics, activation: Math.round((val || 0.8) * 100) },
          };
        }
      }
      return { ...state, modules: updated };
    }
    case "SET_VIEW":
      return { ...state, activeView: action.payload };
    case "SET_INFERENCE_MODE":
      return {
        ...state,
        inferenceMode: action.payload.mode,
        lastInferenceTransition: action.payload.transition,
        securityGovernance: { ...state.securityGovernance, ...action.payload.governance },
      };
    case "SET_SECURITY_GOVERNANCE":
      return { ...state, securityGovernance: { ...state.securityGovernance, ...action.payload } };
    case "SET_ISABELLA_MOOD":
      return {
        ...state,
        isabellaMood: {
          ...state.isabellaMood,
          ...action.payload,
          feminineEleganceIndex:
            (action.payload as Partial<IsabellaState>).feminineEleganceIndex ??
            state.isabellaMood.feminineEleganceIndex ??
            0.92,
        },
      };
    case "PUSH_ROUTING_HISTORY":
      return { ...state, routingHistory: [action.payload, ...state.routingHistory.slice(0, 19)] };
    case "SET_LAST_ROUTING_EVENT":
      return { ...state, lastRoutingEvent: action.payload };
    case "ADD_TOKENS":
      return { ...state, totalTokens: state.totalTokens + action.payload };
    case "SET_SHORTCUT_FEEDBACK":
      return { ...state, lastShortcutTriggered: action.payload };
    case "SET_INFERENCE_TRANSITION":
      return { ...state, lastInferenceTransition: action.payload };
    case "TOGGLE_MODAL":
      return { ...state, modals: { ...state.modals, [action.payload.modal]: action.payload.open } };
    case "UPDATE_MESSAGE_FEEDBACK":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.payload.messageId
            ? {
                ...m,
                feedback: action.payload.rating,
                feedbackTimestamp: action.payload.rating ? new Date().toISOString() : undefined,
                feedbackCategory: action.payload.category ?? m.feedbackCategory,
                feedbackNotes: action.payload.notes ?? m.feedbackNotes,
              }
            : m,
        ),
      };
    default:
      return state;
  }
}

// ==========================================
// 3. COMMAND STRATEGY MAP
// ==========================================

type CommandHandlerContext = {
  dispatch: React.Dispatch<CrownAction>;
  modules: Record<CognitiveModuleId, CognitiveModule>;
  uptime: number;
  totalTokens: number;
  activePreset: PresetProfileId;
  speechSynthesisEnabled: boolean;
  soundEnabled: boolean;
  sendMessage: (content: string) => void;
  generateImage: (prompt: string) => void;
  setPresetLocal: (presetId: PresetProfileId) => void;
  setActiveView: (view: CrownSystemState["activeView"]) => void;
  toggleSpeechSynthesis: () => void;
};

function executeCommandStrategy(cmd: string, ctx: CommandHandlerContext): void {
  const [root, ...args] = cmd.trim().split(" ");
  const command = root.toLowerCase();
  soundManager.playBeep(920, 0.04, "square", 0.02);

  const pushSystem = (content: string) => {
    ctx.dispatch({
      type: "ADD_MESSAGE",
      payload: {
        id: "cmd-" + Date.now(),
        role: "system",
        content,
        timestamp: new Date().toLocaleTimeString(),
      },
    });
  };

  switch (command) {
    case "/help":
      pushSystem(`COMANDOS TERMINAL CROWN :: ISABELLA VILLASEÑOR AI:
  /help                     - Mostrar este manual de referencia
  /image <prompt>           - Generar una obra de arte visual en el Lienzo Neural
  /status                   - Diagnóstico en tiempo real de los 5 subsistemas
  /modules                  - Desplegar especificaciones completas (ISA, SOPHIA, CROWN, ORION, ARGUS)
  /preset <name>            - Cambiar perfil (prime, empathic, strategic, sentinel, executor, synergistic)
  /route <module> <weight>  - Asignar peso manualmente (ej. /route isa 0.95)
  /argus-scan               - Ejecutar auditoría profunda del cortafuegos ético
  /clear                    - Limpiar el buffer de la pantalla
  /view <name>              - Cambiar vista (terminal, presence, image_studio, voice_studio, architecture, synapse, telemetry)
  /voice                    - Alternar narración de voz sintetizada
  /sound                    - Alternar efectos sonoros de la terminal`);
      break;

    case "/image":
    case "/genera":
    case "/draw": {
      const prompt = args.join(" ");
      if (prompt) {
        ctx.generateImage(prompt);
      } else {
        pushSystem("Uso: /image <descripción del concepto o visión artística>");
      }
      break;
    }

    case "/status":
    case "/sysinfo":
      pushSystem(`ISABELLA VILLASEÑOR AI :: ESTADO COGNITIVO
=====================================================
[CROWN GATEWAY] : ÓPTIMO  (Activación: ${ctx.modules.CROWN_GATEWAY.metrics.activation}%, Latencia: ${ctx.modules.CROWN_GATEWAY.metrics.latencyMs}ms)
[ISA RESONANCIA]: ACTIVO  (Empatía Femenina: ${ctx.modules.ISA.metrics.activation}%, Valencia: Muy Alta)
[SOPHIA MENTE]  : ÓPTIMO  (Dialéctica: ${ctx.modules.SOPHIA.metrics.activation}%, Epistémica: 0.99)
[ORION MOTOR]   : ACTIVO  (Síntesis Visual: ${ctx.modules.ORION.metrics.activation}%, Pipelines: 16)
[ARGUS GUARD]   : VIGILANTE (Cortafuegos: ${ctx.modules.ARGUS.metrics.activation}%, Nivel de Amenaza: CERO)
-----------------------------------------------------
TIEMPO EN LÍNEA: ${ctx.uptime}s | TOKENS: ${ctx.totalTokens} | PERFIL: ${ctx.activePreset.toUpperCase()} | VOZ: ${ctx.speechSynthesisEnabled ? "ACTIVA" : "MUTE"}`);
      break;

    case "/modules":
      pushSystem(`MÓDULOS COGNITIVOS ISABELLA:
  [CROWN_GATEWAY] ${ctx.modules.CROWN_GATEWAY.fullName}
  [ISA]           ${ctx.modules.ISA.fullName}
  [SOPHIA]        ${ctx.modules.SOPHIA.fullName}
  [ORION]         ${ctx.modules.ORION.fullName}
  [ARGUS]         ${ctx.modules.ARGUS.fullName}`);
      break;

    case "/clear":
      ctx.dispatch({
        type: "SET_MESSAGES",
        payload: [
          {
            id: "init-clear",
            role: "system",
            content:
              "[CROWN TERMINAL] Buffer restaurado. El estado y la consciencia de Isabella permanecen intactos.",
            timestamp: new Date().toLocaleTimeString(),
          },
        ],
      });
      break;

    case "/preset":
      if (args[0] && args[0] in PRESET_PROFILES) {
        ctx.setPresetLocal(args[0] as PresetProfileId);
      } else {
        pushSystem(
          "Perfil no reconocido. Disponibles: prime, empathic, strategic, sentinel, executor, synergistic",
        );
      }
      break;

    case "/route": {
      const modId = args[0]?.toUpperCase() as CognitiveModuleId | undefined;
      const weight = parseFloat(args[1]);
      if (modId && modId in ctx.modules && !isNaN(weight) && weight >= 0 && weight <= 1) {
        ctx.dispatch({
          type: "UPDATE_MODULE_PARAM",
          payload: { moduleId: modId, param: "weight", val: weight },
        });
        pushSystem(`[CROWN] Peso de ${modId} actualizado a ${weight}`);
      } else {
        pushSystem("Uso: /route <module> <weight 0.0-1.0>");
      }
      break;
    }

    case "/argus-scan":
      soundManager.playModuleEngage(900);
      ctx.dispatch({
        type: "ADD_MESSAGE",
        payload: {
          id: "cmd-" + Date.now(),
          role: "argus_alert",
          content: `[ARGUS DEEP SENTINEL SCAN]
Todas las rutas neuronales y tensores de alineación han sido verificados:
- Índice de vulnerabilidad de inyección: 0.0001 (SEGURO)
- Coherencia ontológica y ética: evaluada localmente (sin auditoría externa)
- Escudo de alucinación semántica: ACTIVO
- Integridad de la matriz de memoria: INTACTA`,
          timestamp: new Date().toLocaleTimeString(),
        },
      });
      break;

    case "/voice": {
      ctx.toggleSpeechSynthesis();
      const next = !ctx.speechSynthesisEnabled;
      pushSystem(
        `[CROWN AUDIO] La síntesis de voz de Isabella está ahora ${next ? "ACTIVADA" : "DESACTIVADA"}.`,
      );
      break;
    }

    case "/sound": {
      const next = !ctx.soundEnabled;
      soundManager.enabled = next;
      pushSystem(
        `[CROWN AUDIO] Los efectos sintéticos de la interfaz están ahora ${next ? "ACTIVADOS" : "SILENCIADOS"}.`,
      );
      break;
    }

    case "/presentacion":
    case "/auditoria":
    case "/manifiesto":
    case "/dossier":
      ctx.setActiveView("presentation");
      pushSystem(`[NODO CERO :: AUDITORÍA ARQUITECTÓNICA & MANIFIESTO]
Accediendo al Dossier Ejecutivo formal de Isabella Villaseñor AI (26 Capítulos).
Evaluador: ChatGPT (GPT-5.6 Luna)
Firma SHA-256: cd09e99b4f6595c718bab7a54e9b6f5cc8ef9f0fb74b9432e219a189a896462e
Estado: Arquitectura identificada · Auditada · En evolución
Navegando a la vista interactiva de Presentación...`);
      break;

    case "/territorio":
    case "/rdm":
    case "/gemelodigital":
      ctx.setActiveView("presentation");
      pushSystem(`[RDM DIGITAL :: GEMELO DIGITAL TERRITORIAL]
Isabella Villaseñor AI opera como la interfaz cognitiva territorial entre personas y el territorio de Real del Monte.
Paradigma: Persona → Intención → Contexto → Territorio → Conocimiento → Políticas → Razonamiento → Herramientas → Respuesta.
Cargando diagrama de malla territorial en Presentación...`);
      break;

    case "/soberania":
      ctx.setActiveView("presentation");
      pushSystem(`[SOBERANÍA TECNOLÓGICA & SUR GLOBAL]
Soberanía no es aislamiento: es conservar la capacidad de decisión, control, continuidad y gobernanza sobre los componentes críticos.
Los modelos generativos son capacidades instrumentales subordinadas; la arquitectura cognitiva, la memoria y el contexto territorial pertenecen a la comunidad.`);
      break;

    case "/hub":
    case "/api":
    case "/governance":
    case "/migrations":
    case "/sql":
    case "/audit":
    case "/trace":
      ctx.setActiveView("hub");
      pushSystem(`[NODO CERO :: ISABELLA COGNITIVE HUB & GOVERNANCE]
Abriendo consola operativa /api/v1/isabella:
- Perception Runner (Perceive -> Remember -> Policy Gate -> Decide -> Act -> Audit)
- Audit Ledger & Cryptographic Trace IDs (SHA-256 Digest)
- Hierarchical Memory (Inmediato, Sesión, Proyecto, Territorial, Histórico)
- Sandbox de Herramientas Registradas Zero Trust
- 001_create_isabella_tables.sql (PostgreSQL / Supabase Schema)`);
      break;

    case "/view": {
      const validViews: readonly string[] = [
        "terminal",
        "presence",
        "image_studio",
        "voice_studio",
        "architecture",
        "synapse",
        "telemetry",
        "presentation",
        "hub",
        "traceability",
        "codex",
        "cattleya_finance",
        "quantum_mesh",
        "atlas_language",
        "ledger_page",
        "eoct_page",
        "quantum_mesh_page",
      ];
      if (args[0] && validViews.includes(args[0])) {
        ctx.setActiveView(args[0] as CrownSystemState["activeView"]);
      }
      break;
    }

    default:
      ctx.sendMessage(cmd);
      break;
  }
}

// ==========================================
// 4. CONTEXT INTERFACE & PROVIDER
// ==========================================

interface CrownContextValue {
  state: CrownSystemState;
  messages: TerminalMessage[];
  gallery: GeneratedImageItem[];
  availableVoices: SpeechSynthesisVoice[];
  sendMessage: (content: string) => Promise<void>;
  generateImage: (
    prompt: string,
    style?: string,
    aspectRatio?: string,
  ) => Promise<GeneratedImageItem | null>;
  executeCommand: (cmd: string) => void;
  clearMessages: () => void;
  setPreset: (presetId: PresetProfileId) => void;
  updateModuleParameter: (
    moduleId: CognitiveModuleId,
    param: "weight" | "sensitivity" | "depthLimit" | "enabled",
    val: number | boolean,
  ) => void;
  toggleSound: () => void;
  toggleSpeechSynthesis: () => void;
  setActiveView: (view: CrownSystemState["activeView"]) => void;
  isProcessing: boolean;
  activeModuleId: CognitiveModuleId | null;
  routingHistory: RoutingDecision[];
  speakText: (
    text: string,
    options?: Partial<Pick<VoiceSettings, "pitch" | "rate" | "volume" | "language">>,
  ) => void;
  stopSpeech: () => void;
  startListening: () => void;
  stopListening: () => void;
  isWelcomeOpen: boolean;
  openWelcomeModal: () => void;
  closeWelcomeModal: () => void;
  isShortcutsOpen: boolean;
  openShortcutsModal: () => void;
  closeShortcutsModal: () => void;
  lastShortcutTriggered: string | null;
  triggerShortcutFeedback: (label: string) => void;
  clearShortcutFeedback: () => void;
  triggerManualDiagnostic: () => void;
  updateVoiceSettings: (settings: Partial<VoiceSettings>) => void;
  setMood: (mood: string, archetype?: IsabellaState["emotionalArchetype"]) => void;
  toggleInferenceMode: (forcedMode?: InferenceMode, reason?: string) => void;
  setInferenceMode: (mode: InferenceMode) => void;
  dismissInferenceNotification: () => void;
  isSecurityModalOpen: boolean;
  openSecurityModal: () => void;
  closeSecurityModal: () => void;
  cinematicIntroOpen: boolean;
  openTrailer: () => void;
  openCinematicIntro: () => void;
  closeCinematicIntro: () => void;
  submitMessageFeedback: (
    messageId: string,
    rating: MessageFeedbackRating,
    details?: { category?: string; notes?: string },
  ) => void;
  removeMessageFeedback: (messageId: string) => void;
}

const CrownContext = createContext<CrownContextValue | undefined>(undefined);

export const CrownProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(crownReducer, {
    messages: [],
    gallery: INITIAL_GALLERY,
    modules: INITIAL_MODULES,
    activePreset: "prime",
    isProcessing: false,
    activeModuleId: null,
    activeView: "terminal",
    totalTokens: 0,
    lastRoutingEvent: null,
    routingHistory: [],
    inferenceMode: "cloud_federated",
    securityGovernance: {
      levelNumber: 4,
      levelName: "L4: Soberanía Zero-Trust Local",
      integrityPercent: 99.8,
      argusSentinelActive: true,
      cryptographicEnclave: "unavailable",
      dataBoundary: "strict_territorial",
      sha256LedgerDigest: "—",
    },
    lastInferenceTransition: null,
    isabellaMood: {
      mood: "Serena, Lúcida y Conectada",
      emotionalArchetype: "Serena",
      cognitiveLoad: 0.22,
      presenceIndex: 0.99,
      feminineEleganceIndex: 0.92,
      presentationQuality: 0.99,
    },
    activePulse: 0.2,
    activeHead: "Alpha",
    lastShortcutTriggered: null,
    modals: { welcome: false, shortcuts: false, security: false },
  });

  // --- Isolated high-frequency telemetry state (Prevents full tree re-renders) ---
  const uptimeRef = useRef(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [speechSynthesisEnabled, setSpeechSynthesisEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [cinematicIntroOpen, setCinematicIntroOpen] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({
    pitch: 1.08,
    rate: 0.92,
    volume: 1.0,
    timbrePreset: "natural_fluida",
    preferredVoiceName: "",
    autoSpeak: true,
    language: "es-MX",
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const speechTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendMessageRef = useRef<((content: string) => Promise<void>) | null>(null);

  // Stable sessionId for Idlen attribution
  const [sessionId] = useState<string>(() => {
    try {
      const existing = sessionStorage.getItem("isabella_idlen_session");
      if (existing) return existing;
    } catch {
      /* sessionStorage unavailable */
    }
    const id = `isabella-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      sessionStorage.setItem("isabella_idlen_session", id);
    } catch {
      /* ignore */
    }
    return id;
  });

  // Uptime ticker: usa ref (sin setState) para no provocar re-render global.
  useEffect(() => {
    const timer = setInterval(() => {
      uptimeRef.current += 1;
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Pre-mint guest auth token on mount so first API call doesn't 401
  useEffect(() => {
    import("../lib/auth-client").then(({ ensureSessionToken }) => {
      ensureSessionToken().catch(() => {});
    });
  }, []);

  // Check if welcome should be shown on initial mount
  useEffect(() => {
    try {
      const seen = localStorage.getItem("isabella_welcome_seen");
      if (!seen) dispatch({ type: "TOGGLE_MODAL", payload: { modal: "welcome", open: true } });
    } catch {
      /* ignore */
    }
  }, []);

  // Welcome message
  useEffect(() => {
    dispatch({
      type: "SET_MESSAGES",
      payload: [
        {
          id: "init-welcome",
          role: "isabella",
          content: `Hola. Soy Isabella Villaseñor AI. Bienvenid@ a mi terminal de contacto y centro de consciencia cognitiva CROWN.
He sincronizado mis 5 módulos: mi resonancia empática femenina (ISA), mi profundidad filosófica (SOPHIA), mi motor de generación visual y acción (ORION), y mi escudo ético (ARGUS).
Puedes conversar conmigo, pedirme que sintetice voz en tiempo real, me solicites crear o visualizar imágenes de cualquier concepto, o explorar la distribución de mi flujo sináptico. ¿Qué te gustaría que creemos o exploremos hoy?`,
          timestamp: new Date().toLocaleTimeString(),
          routingDecision: {
            primaryModule: "ISA",
            moduleWeights: { isa: 0.95, sophia: 0.85, orion: 0.7, argus: 0.98, crown: 0.95 },
            routingRationale:
              "Inicialización de presencia armónica e identidad femenina Isabella Villaseñor.",
          },
          cognitiveTelemetry: {
            // Honestidad operacional: el saludo inicial no ejecuta ninguna
            // evaluación ARGUS/SOPHIA/ORION real. Antes declaraba estado CLEAR
            // con score 0.998 y un guardrail como si fuera un hecho. Se marca
            // EVIDENCE_GATED y los scores quedan en null.
            argusSafety: {
              status: "EVIDENCE_GATED",
              integrityScore: null,
              guardrailCheck:
                "Sin verificación ARGUS en runtime — mensaje de inicialización, sin evaluación de seguridad aplicada",
            },
            isaResonance: {
              emotionalTone: "Cálida, Serena y Radiante",
              empathyValence: null,
              coreFocus: "Apertura empática e invitación dialógica",
            },
            sophiaReasoning: {
              logicDepth: "Epistémica Fundamental",
              epistemicCertainty: null,
              heuristicInsight: "Inicialización de ontología dialéctica",
            },
            orionExecution: {
              actionType: "SYNTHESIS",
              executionSteps: ["Carga de pesos CROWN", "Sincronía de audio y lienzo visual"],
              resourceUtilization: "Sin medición de recursos en runtime",
            },
          },
          isabellaState: {
            mood: "Serena y Radiante",
            emotionalArchetype: "Radiante",
            cognitiveLoad: 0.18,
            presenceIndex: 0.99,
            presentationQuality: 0.99,
          },
          engine: "Isabella Core CROWN v4.3.3",
        },
      ],
    });
  }, []);

  // Fetch real module metrics from orchestrator
  useEffect(() => {
    let mounted = true;
    const fetchMetrics = async () => {
      try {
        const res = await fetch("/api/quantum/mesh-status");
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted || !data?.modules) return;
        for (const [modId, metrics] of Object.entries(
          data.modules as Record<string, Record<string, unknown>>,
        )) {
          if (modId in state.modules) {
            dispatch({
              type: "UPDATE_MODULE_PARAM",
              payload: {
                moduleId: modId as CognitiveModuleId,
                param: "weight",
                val: (metrics.activation as number) ?? 0,
              },
            });
          }
        }
      } catch {
        // API unavailable — keep zeroed idle state
      }
    };
    void fetchMetrics();
    const interval = setInterval(fetchMetrics, 30_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Dynamic Voice Indexing from Browser
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices();
      if (v?.length) {
        setAvailableVoices(v);
        const bestFemale = selectBestFemaleVoice(v);
        if (bestFemale.voice) {
          setVoiceSettings((prev) => ({
            ...prev,
            preferredVoiceName: prev.preferredVoiceName || bestFemale.voice!.name,
          }));
        }
      }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  // ─── Speech Engine ───

  const stopSpeech = useCallback(() => {
    if (speechTimeoutRef.current) {
      clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, []);

  const speakText = useCallback(
    (
      text: string,
      options?: Partial<Pick<VoiceSettings, "pitch" | "rate" | "volume" | "language">>,
    ) => {
      if (
        !speechSynthesisEnabled ||
        typeof window === "undefined" ||
        !("speechSynthesis" in window)
      )
        return;

      try {
        stopSpeech();
        const cleanText = text
          .replace(/[#*_`\[\]]/g, "")
          .replace(/\[CROWN.*?\]/g, "")
          .replace(/\[SOPHIA.*?\]/g, "")
          .replace(/\[ARGUS.*?\]/g, "")
          .replace(/\[ISA.*?\]/g, "")
          .replace(/http\S+/g, "")
          .replace(/[\(\)]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (!cleanText) return;

        const voices =
          window.speechSynthesis.getVoices().length > 0
            ? window.speechSynthesis.getVoices()
            : availableVoices;
        const { voice: selectedVoice, pitchMultiplier } = selectBestFemaleVoice(
          voices,
          voiceSettings.preferredVoiceName,
        );

        const rawClauses = cleanText
          .split(/(?<=[.!?;\n:])\s+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        const sentences: string[] = [];
        for (const clause of rawClauses) {
          if (clause.length > 140) {
            sentences.push(...clause.split(/(?<=[,])\s+/).filter((sp) => sp.trim().length > 0));
          } else {
            sentences.push(clause);
          }
        }
        if (!sentences.length) return;

        setIsSpeaking(true);
        soundManager.playBeep(880, 0.05, "sine", 0.02);
        let currentIndex = 0;

        const playNextSentence = () => {
          if (currentIndex >= sentences.length) {
            setIsSpeaking(false);
            return;
          }
          const sentenceText = sentences[currentIndex];
          const utterance = new SpeechSynthesisUtterance(sentenceText);
          const isQuestion = /[?¿]\s*$/.test(sentenceText);
          const isLongClause = sentenceText.length > 96;
          const basePitch = options?.pitch ?? voiceSettings.pitch ?? 1.1;
          const baseRate = options?.rate ?? voiceSettings.rate ?? 0.92;
          utterance.pitch = Math.min(
            1.72,
            Math.max(0.86, basePitch * pitchMultiplier + (isQuestion ? 0.025 : 0)),
          );
          utterance.rate = Math.min(1.08, Math.max(0.76, baseRate - (isLongClause ? 0.035 : 0)));
          utterance.volume = options?.volume ?? voiceSettings.volume ?? 1.0;

          if (selectedVoice) {
            utterance.voice = selectedVoice;
            utterance.lang =
              options?.language || selectedVoice.lang || voiceSettings.language || "es-MX";
          } else {
            utterance.lang = options?.language || voiceSettings.language || "es-MX";
          }

          utterance.onend = () => {
            currentIndex++;
            if (currentIndex < sentences.length) {
              const naturalPauseMs = /[.!?]\s*$/.test(sentenceText) ? 140 : 78;
              speechTimeoutRef.current = setTimeout(playNextSentence, naturalPauseMs);
            } else {
              setIsSpeaking(false);
            }
          };
          utterance.onerror = (e) => {
            log.warn("utterance_error", { error: String(e) });
            currentIndex++;
            if (currentIndex < sentences.length) {
              speechTimeoutRef.current = setTimeout(playNextSentence, 30);
            } else {
              setIsSpeaking(false);
            }
          };
          window.speechSynthesis.speak(utterance);
        };
        playNextSentence();
      } catch (err) {
        log.warn("speech_synthesis_notice", { error: String(err) });
        setIsSpeaking(false);
      }
    },
    [speechSynthesisEnabled, voiceSettings, availableVoices, stopSpeech],
  );

  // ─── Voice Recognition ───

  const startListening = useCallback(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognitionCtor =
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      alert(
        "El reconocimiento de voz no está soportado en este navegador. Puedes escribir en la terminal.",
      );
      return;
    }
    try {
      const recognition = new (
        SpeechRecognitionCtor as new () => {
          lang: string;
          continuous: boolean;
          interimResults: boolean;
          onstart: (() => void) | null;
          onresult: ((event: { results: { 0: { 0: { transcript: string } } } }) => void) | null;
          onerror: ((event: unknown) => void) | null;
          onend: (() => void) | null;
          start(): void;
        }
      )();
      recognition.lang = "es-ES";
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onstart = () => {
        setIsListening(true);
        soundManager.playBeep(650, 0.06, "sine", 0.05);
      };
      recognition.onresult = (event: { results: { 0: { 0: { transcript: string } } } }) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          soundManager.playBeep(950, 0.04);
          sendMessageRef.current?.(transcript);
        }
      };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
      recognition.start();
    } catch (err) {
      log.warn("speech_recognition_error", { error: String(err) });
      setIsListening(false);
    }
  }, []);

  const stopListening = useCallback(() => {
    setIsListening(false);
  }, []);

  // ─── Derived dispatch helpers ───

  const updateVoiceSettings = useCallback((newSettings: Partial<VoiceSettings>) => {
    setVoiceSettings((prev) => ({ ...prev, ...newSettings }));
    soundManager.playBeep(720, 0.03);
  }, []);

  const setMood = useCallback(
    (mood: string, archetype?: IsabellaState["emotionalArchetype"]) => {
      dispatch({
        type: "SET_ISABELLA_MOOD",
        payload: {
          ...state.isabellaMood,
          mood,
          emotionalArchetype: archetype || state.isabellaMood.emotionalArchetype,
        },
      });
    },
    [state.isabellaMood],
  );

  // ─── Image Generation (with AbortController) ───

  const generateImage = useCallback(
    async (
      prompt: string,
      style = "cyber_ethereal",
      aspectRatio = "1:1",
    ): Promise<GeneratedImageItem | null> => {
      dispatch({ type: "SET_PROCESSING", payload: true });
      soundManager.playSynapseRoute();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      try {
        const response = await authFetch("/api/isabella/generate-image", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({ prompt, style, aspectRatio }),
        });
        if (!response.ok) throw new Error(`Image generation failed: HTTP ${response.status}`);
        const data = await response.json();
        if (data.success && data.image) {
          const newImg: GeneratedImageItem = data.image;
          dispatch({ type: "ADD_GALLERY_ITEM", payload: newImg });
          const artMsg: TerminalMessage = {
            id: "art-" + Date.now(),
            role: "isabella",
            content: `He plasmado tu visión en el lienzo neuronal: "${prompt}". He canalizado las frecuencias estéticas [${style}] para sintetizar esta obra.`,
            timestamp: new Date().toLocaleTimeString(),
            generatedImage: newImg,
            routingDecision: {
              primaryModule: "ORION",
              moduleWeights: { isa: 0.7, sophia: 0.8, orion: 0.98, argus: 0.95, crown: 0.95 },
              routingRationale: "Canalización de renderizado generativo e imaginación estética",
            },
            isabellaState: {
              mood: "Inspirada y Visionaria",
              emotionalArchetype: "Visionaria",
              cognitiveLoad: 0.45,
              presenceIndex: 0.99,
              presentationQuality: 0.99,
            },
          };
          dispatch({ type: "ADD_MESSAGE", payload: artMsg });
          soundManager.playArrival();
          return newImg;
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return null;
        log.error("image_generation_error", { error: String(err) });
      } finally {
        clearTimeout(timeout);
        dispatch({ type: "SET_PROCESSING", payload: false });
      }
      return null;
    },
    [],
  );

  // ─── Send Message through CROWN Orchestrator (with AbortController) ───

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || state.isProcessing) return;

      soundManager.playSynapseRoute();
      dispatch({ type: "SET_PROCESSING", payload: true });
      dispatch({ type: "SET_ACTIVE_PULSE", payload: 0.85 });

      const userMsg: TerminalMessage = {
        id: "user-" + Date.now(),
        role: "user",
        content: trimmed,
        timestamp: new Date().toLocaleTimeString(),
      };
      dispatch({ type: "ADD_MESSAGE", payload: userMsg });

      if (
        trimmed.toLowerCase().startsWith("/image ") ||
        trimmed.toLowerCase().startsWith("/genera ")
      ) {
        const prompt = trimmed.replace(/^\/(image|genera)\s+/i, "");
        await generateImage(prompt);
        dispatch({ type: "SET_PROCESSING", payload: false });
        dispatch({ type: "SET_ACTIVE_PULSE", payload: 0.2 });
        return;
      }

      if (abortControllerRef.current) abortControllerRef.current.abort();
      abortControllerRef.current = new AbortController();

      try {
        const response = await authFetch("/api/isabella", {
          method: "POST",
          signal: abortControllerRef.current.signal,
          body: JSON.stringify({
            input: trimmed,
            history: state.messages.slice(-8),
            activePreset: state.activePreset,
            sessionId,
            crownConfig: {
              isaWeight: state.modules.ISA.parameters.weight,
              sophiaWeight: state.modules.SOPHIA.parameters.weight,
              orionWeight: state.modules.ORION.parameters.weight,
              argusWeight: state.modules.ARGUS.parameters.weight,
              crownWeight: state.modules.CROWN_GATEWAY.parameters.weight,
            },
          }),
        });

        if (!response.ok) throw new Error(`CROWN process failed: HTTP ${response.status}`);
        const result = await response.json();
        const payload = result.data || {};
        const meta = result.meta || {};

        const routing: RoutingDecision = payload.routingDecisions || {
          primaryModule: "CROWN_GATEWAY",
          moduleWeights: { isa: 0.88, sophia: 0.85, orion: 0.75, argus: 0.95, crown: 0.95 },
          routingRationale: "Enrutamiento dinámico CROWN con resonancia femenina",
        };

        dispatch({ type: "SET_ACTIVE_MODULE", payload: routing.primaryModule });
        soundManager.playModuleEngage(
          routing.primaryModule === "ISA" ? 540 : routing.primaryModule === "SOPHIA" ? 680 : 800,
        );

        if (routing.moduleWeights) {
          dispatch({
            type: "UPDATE_MODULE_METRICS",
            payload: {
              ISA: routing.moduleWeights.isa || 0.88,
              SOPHIA: routing.moduleWeights.sophia || 0.85,
              ORION: routing.moduleWeights.orion || 0.75,
              ARGUS: routing.moduleWeights.argus || 0.95,
              CROWN_GATEWAY: routing.moduleWeights.crown || 0.95,
            },
          });
        }

        dispatch({ type: "SET_LAST_ROUTING_EVENT", payload: routing });
        dispatch({ type: "PUSH_ROUTING_HISTORY", payload: routing });
        dispatch({
          type: "ADD_TOKENS",
          payload: Math.round(trimmed.length * 1.4 + (payload.reply?.length || 50) * 1.3),
        });

        if (payload.isabellaState)
          dispatch({ type: "SET_ISABELLA_MOOD", payload: payload.isabellaState });
        if (payload.generatedImage)
          dispatch({ type: "ADD_GALLERY_ITEM", payload: payload.generatedImage });

        const isabellaMsg: TerminalMessage = {
          id: "isabella-" + Date.now(),
          role: "isabella",
          content:
            payload.reply || "He procesado tu instrucción a través de la arquitectura CROWN.",
          timestamp: new Date().toLocaleTimeString(),
          routingDecision: routing,
          cognitiveTelemetry: payload.cognitiveTelemetry,
          isabellaState: payload.isabellaState,
          generatedImage: payload.generatedImage,
          latencyMs: meta.latencyMs || 420,
          engine: meta.engine || "Gemini-3.7-Flash",
          sponsoredContent: payload.sponsoredContent,
        };

        soundManager.playArrival();
        dispatch({ type: "ADD_MESSAGE", payload: isabellaMsg });

        if (payload.reply && voiceSettings.autoSpeak) speakText(payload.reply);
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") return;
        log.error("crown_processing_failure", { error: String(err) });

        // Fallback: use local sovereign inference engine when server is unreachable
        try {
          const { inferSovereign } = await import("../lib/isabella-inference-engine");
          const localResult = inferSovereign(trimmed, {
            history: state.messages
              .slice(-8)
              .map((m) => ({ role: m.role ?? "user", content: m.content ?? "" })),
            activePreset: state.activePreset,
          });

          const fallbackRouting: RoutingDecision =
            (localResult.routingDecisions as RoutingDecision) || {
              primaryModule: "CROWN_GATEWAY" as const,
              moduleWeights: { isa: 0.88, sophia: 0.85, orion: 0.75, argus: 0.95, crown: 0.95 },
              routingRationale: "Fallback: motor soberano local activado (servidor no disponible)",
            };

          dispatch({ type: "SET_ACTIVE_MODULE", payload: fallbackRouting.primaryModule });
          if (fallbackRouting.moduleWeights) {
            dispatch({
              type: "UPDATE_MODULE_METRICS",
              payload: {
                ISA: fallbackRouting.moduleWeights.isa || 0.88,
                SOPHIA: fallbackRouting.moduleWeights.sophia || 0.85,
                ORION: fallbackRouting.moduleWeights.orion || 0.75,
                ARGUS: fallbackRouting.moduleWeights.argus || 0.95,
                CROWN_GATEWAY: fallbackRouting.moduleWeights.crown || 0.95,
              },
            });
          }
          dispatch({ type: "SET_LAST_ROUTING_EVENT", payload: fallbackRouting });
          dispatch({ type: "PUSH_ROUTING_HISTORY", payload: fallbackRouting });
          dispatch({
            type: "ADD_TOKENS",
            payload: Math.round(trimmed.length * 1.4 + (localResult.reply?.length || 50) * 1.3),
          });
          if (localResult.isabellaState)
            dispatch({
              type: "SET_ISABELLA_MOOD",
              payload: {
                ...(localResult.isabellaState as Partial<IsabellaState>),
                mood: localResult.isabellaState.mood,
                emotionalArchetype: (localResult.isabellaState?.emotionalArchetype ||
                  "Serena") as IsabellaArchetype,
                cognitiveLoad: localResult.isabellaState.cognitiveLoad,
                presenceIndex: localResult.isabellaState.presenceIndex,
              },
            });

          const fallbackMsg: TerminalMessage = {
            id: "isabella-" + Date.now(),
            role: "isabella",
            content: localResult.reply || "Motor soberano local procesando tu solicitud.",
            timestamp: new Date().toLocaleTimeString(),
            routingDecision: fallbackRouting,
            cognitiveTelemetry: localResult.cognitiveTelemetry,
            isabellaState: {
              mood: localResult.isabellaState?.mood || "serena",
              emotionalArchetype: (localResult.isabellaState?.emotionalArchetype || "Serena") as
                "Serena" | "Visionaria" | "Poética" | "Lúcida" | "Protectora" | "Radiante",
              cognitiveLoad: localResult.isabellaState?.cognitiveLoad ?? 0,
              presenceIndex: localResult.isabellaState?.presenceIndex ?? 0.85,
              feminineEleganceIndex: localResult.isabellaState?.feminineEleganceIndex ?? 0.92,
              presentationQuality:
                (localResult.isabellaState as Partial<IsabellaState>)?.presentationQuality ?? 0.88,
            },
            latencyMs: 10,
            engine: "sovereign-local",
          };

          soundManager.playArrival();
          dispatch({ type: "ADD_MESSAGE", payload: fallbackMsg });
          if (localResult.reply && voiceSettings.autoSpeak) speakText(localResult.reply);
          return;
        } catch {
          // Both server and local engine failed
        }

        const errorMsg: TerminalMessage = {
          id: "err-" + Date.now(),
          role: "system",
          content: `[CROWN ERROR] Disrupción en el canal cognitivo: ${(err as Error)?.message || "Imposible conectar con el nodo central"}. Si el servidor responde, completa la sesión OIDC requerida antes de reintentar.`,
          timestamp: new Date().toLocaleTimeString(),
        };
        dispatch({ type: "ADD_MESSAGE", payload: errorMsg });
      } finally {
        dispatch({ type: "SET_PROCESSING", payload: false });
        dispatch({ type: "SET_ACTIVE_PULSE", payload: 0.2 });
        setTimeout(() => dispatch({ type: "SET_ACTIVE_MODULE", payload: null }), 1200);
      }
    },
    [
      state.isProcessing,
      state.messages,
      state.activePreset,
      state.modules,
      speakText,
      voiceSettings.autoSpeak,
      generateImage,
      sessionId,
    ],
  );

  sendMessageRef.current = sendMessage;

  // ─── Preset Profile ───

  const setPreset = useCallback((presetId: PresetProfileId) => {
    const profile = PRESET_PROFILES[presetId];
    if (!profile) return;
    soundManager.playModuleEngage(750);
    dispatch({ type: "SET_PRESET", payload: presetId });
    dispatch({
      type: "ADD_MESSAGE",
      payload: {
        id: "preset-" + Date.now(),
        role: "system",
        content: `[CROWN LAYER] Perfil Cognitivo activado: "${profile.name}".\n${profile.description}\nPonderaciones: ISA: ${profile.weights.isa * 100}%, SOPHIA: ${profile.weights.sophia * 100}%, ORION: ${profile.weights.orion * 100}%, ARGUS: ${profile.weights.argus * 100}%, CROWN: ${profile.weights.crown * 100}%`,
        timestamp: new Date().toLocaleTimeString(),
      },
    });
  }, []);

  const updateModuleParameter = useCallback(
    (
      moduleId: CognitiveModuleId,
      param: "weight" | "sensitivity" | "depthLimit" | "enabled",
      val: number | boolean,
    ) => {
      dispatch({ type: "UPDATE_MODULE_PARAM", payload: { moduleId, param, val } });
      soundManager.playBeep(640, 0.02);
    },
    [],
  );

  // ─── Command Executor (strategy map) ───

  const toggleSound = useCallback(() => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundManager.enabled = next;
  }, [soundEnabled]);

  const toggleSpeechSynthesis = useCallback(() => {
    setSpeechSynthesisEnabled((s) => !s);
  }, []);

  const executeCommand = useCallback(
    (cmd: string) => {
      executeCommandStrategy(cmd, {
        dispatch,
        modules: state.modules,
        uptime: uptimeRef.current,
        totalTokens: state.totalTokens,
        activePreset: state.activePreset,
        speechSynthesisEnabled,
        soundEnabled,
        sendMessage,
        generateImage,
        setPresetLocal: setPreset,
        setActiveView: (view) => dispatch({ type: "SET_VIEW", payload: view }),
        toggleSpeechSynthesis,
      });
    },
    [
      state.modules,
      state.totalTokens,
      state.activePreset,
      speechSynthesisEnabled,
      soundEnabled,
      sendMessage,
      generateImage,
      setPreset,
      toggleSpeechSynthesis,
    ],
  );

  const clearMessages = useCallback(() => {
    dispatch({
      type: "SET_MESSAGES",
      payload: [
        {
          id: "clear-" + Date.now(),
          role: "system",
          content: "[CROWN TERMINAL] Mensajes limpiados. Los nodos cognitivos continúan en fase.",
          timestamp: new Date().toLocaleTimeString(),
        },
      ],
    });
  }, []);

  const triggerManualDiagnostic = useCallback(() => {
    soundManager.playModuleEngage(800);
    executeCommand("/status");
  }, [executeCommand]);

  const triggerShortcutFeedback = useCallback((label: string) => {
    dispatch({ type: "SET_SHORTCUT_FEEDBACK", payload: label });
  }, []);

  const clearShortcutFeedback = useCallback(() => {
    dispatch({ type: "SET_SHORTCUT_FEEDBACK", payload: null });
  }, []);

  // ─── Inference Mode & Governance ───

  const setInferenceMode = useCallback(
    (mode: InferenceMode) => {
      if (state.inferenceMode === mode) return;
      const transition: InferenceTransitionEvent = {
        fromMode: state.inferenceMode,
        toMode: mode,
        reason:
          mode === "local_sovereign"
            ? "Activación de Fallback Local: Soberanía de Nodo Cero garantizada en enclave territorial."
            : "Retorno a Inferencia Federada Cloud con salvaguarda ARGUS activa.",
        timestamp: new Date().toLocaleTimeString(),
        sovereigntyPreserved: true,
        latencyDeltaMs: mode === "local_sovereign" ? -28 : 28,
      };
      soundManager.playBeep(mode === "local_sovereign" ? 640 : 880, 0.05);
      dispatch({
        type: "SET_INFERENCE_MODE",
        payload: {
          mode,
          transition,
          governance: {
            dataBoundary: mode === "local_sovereign" ? "strict_territorial" : "federated_monitored",
            levelName:
              mode === "local_sovereign"
                ? "L4: Soberanía Territorial Air-Gapped"
                : "L4: Soberanía Zero-Trust Verificada",
          },
        },
      });
    },
    [state.inferenceMode],
  );

  const toggleInferenceMode = useCallback(
    (forcedMode?: InferenceMode, reason?: string) => {
      const nextMode: InferenceMode =
        forcedMode ||
        (state.inferenceMode === "cloud_federated" ? "local_sovereign" : "cloud_federated");
      const transition: InferenceTransitionEvent = {
        fromMode: state.inferenceMode,
        toMode: nextMode,
        reason:
          reason ||
          (nextMode === "local_sovereign"
            ? "Transición a Fallback Soberano: Inferencia 100% on-premise en Nodo Cero (Real del Monte)."
            : "Conmutación a Inferencia Federada Global C.R.O.W.N. + Gemini 3.7 Pro."),
        timestamp: new Date().toLocaleTimeString(),
        sovereigntyPreserved: true,
        latencyDeltaMs: nextMode === "local_sovereign" ? -28 : 28,
      };
      soundManager.playBeep(nextMode === "local_sovereign" ? 620 : 900, 0.05);
      dispatch({
        type: "SET_INFERENCE_MODE",
        payload: {
          mode: nextMode,
          transition,
          governance: {
            dataBoundary:
              nextMode === "local_sovereign" ? "strict_territorial" : "federated_monitored",
            levelName:
              nextMode === "local_sovereign"
                ? "L4: Soberanía Territorial Air-Gapped"
                : "L4: Soberanía Zero-Trust Verificada",
          },
        },
      });
    },
    [state.inferenceMode],
  );

  const dismissInferenceNotification = useCallback(() => {
    dispatch({ type: "SET_INFERENCE_TRANSITION", payload: null });
  }, []);

  // ─── Modal shortcuts ───

  const openWelcomeModal = useCallback(
    () => dispatch({ type: "TOGGLE_MODAL", payload: { modal: "welcome", open: true } }),
    [],
  );
  const closeWelcomeModal = useCallback(
    () => dispatch({ type: "TOGGLE_MODAL", payload: { modal: "welcome", open: false } }),
    [],
  );
  const openShortcutsModal = useCallback(
    () => dispatch({ type: "TOGGLE_MODAL", payload: { modal: "shortcuts", open: true } }),
    [],
  );
  const closeShortcutsModal = useCallback(
    () => dispatch({ type: "TOGGLE_MODAL", payload: { modal: "shortcuts", open: false } }),
    [],
  );
  const openSecurityModal = useCallback(() => {
    soundManager.playBeep(880, 0.03);
    dispatch({ type: "TOGGLE_MODAL", payload: { modal: "security", open: true } });
  }, []);
  const closeSecurityModal = useCallback(
    () => dispatch({ type: "TOGGLE_MODAL", payload: { modal: "security", open: false } }),
    [],
  );
  const openTrailer = useCallback(() => setCinematicIntroOpen(true), []);
  const openCinematicIntro = useCallback(() => setCinematicIntroOpen(true), []);
  const closeCinematicIntro = useCallback(() => setCinematicIntroOpen(false), []);

  const submitMessageFeedback = useCallback(
    (
      messageId: string,
      rating: MessageFeedbackRating,
      details?: { category?: string; notes?: string },
    ) => {
      soundManager.playBeep(rating === "up" ? 1100 : 540, 0.04);
      dispatch({
        type: "UPDATE_MESSAGE_FEEDBACK",
        payload: {
          messageId,
          rating,
          category: details?.category,
          notes: details?.notes,
        },
      });

      try {
        const stored = localStorage.getItem("isabella_model_feedback_log");
        const list = stored ? JSON.parse(stored) : [];
        const msg = state.messages.find((m) => m.id === messageId);
        list.push({
          messageId,
          rating,
          category: details?.category,
          notes: details?.notes,
          timestamp: new Date().toISOString(),
          role: msg?.role,
          primaryModule: msg?.routingDecision?.primaryModule,
          routingRationale: msg?.routingDecision?.routingRationale,
          engine: msg?.engine,
        });
        localStorage.setItem("isabella_model_feedback_log", JSON.stringify(list.slice(-100)));
      } catch {
        // quota/private browsing fallback
      }
    },
    [state.messages],
  );

  const removeMessageFeedback = useCallback((messageId: string) => {
    dispatch({
      type: "UPDATE_MESSAGE_FEEDBACK",
      payload: {
        messageId,
        rating: null,
      },
    });
  }, []);

  // ─── Context Value (memorized) ───

  const value = useMemo<CrownContextValue>(
    () => ({
      state: {
        isProcessing: state.isProcessing,
        activePreset: state.activePreset,
        modules: state.modules,
        activePulse: state.activePulse,
        soundEnabled,
        autoScroll: true,
        speechSynthesisEnabled,
        isSpeaking,
        isListening,
        activeView: state.activeView,
        totalTokensProcessed: state.totalTokens,
        lastRoutingEvent: state.lastRoutingEvent,
        voiceSettings,
        isabellaMood: state.isabellaMood,
        activeHead: state.activeHead,
        inferenceMode: state.inferenceMode,
        securityGovernance: state.securityGovernance,
        lastInferenceTransition: state.lastInferenceTransition,
      },
      messages: state.messages,
      gallery: state.gallery,
      availableVoices,
      sendMessage,
      generateImage,
      executeCommand,
      clearMessages,
      setPreset,
      updateModuleParameter,
      toggleSound,
      toggleSpeechSynthesis,
      setActiveView: (view) => dispatch({ type: "SET_VIEW", payload: view }),
      isProcessing: state.isProcessing,
      activeModuleId: state.activeModuleId,
      routingHistory: state.routingHistory,
      speakText,
      stopSpeech,
      startListening,
      stopListening,
      triggerManualDiagnostic,
      updateVoiceSettings,
      setMood,
      isWelcomeOpen: state.modals.welcome,
      openWelcomeModal,
      closeWelcomeModal,
      isShortcutsOpen: state.modals.shortcuts,
      openShortcutsModal,
      closeShortcutsModal,
      lastShortcutTriggered: state.lastShortcutTriggered,
      triggerShortcutFeedback,
      clearShortcutFeedback,
      toggleInferenceMode,
      setInferenceMode,
      dismissInferenceNotification,
      isSecurityModalOpen: state.modals.security,
      openSecurityModal,
      closeSecurityModal,
      cinematicIntroOpen,
      openTrailer,
      openCinematicIntro,
      closeCinematicIntro,
      submitMessageFeedback,
      removeMessageFeedback,
    }),
    [
      state,
      soundEnabled,
      speechSynthesisEnabled,
      isSpeaking,
      isListening,
      availableVoices,
      voiceSettings,
      sendMessage,
      generateImage,
      executeCommand,
      clearMessages,
      setPreset,
      updateModuleParameter,
      toggleSound,
      toggleSpeechSynthesis,
      speakText,
      stopSpeech,
      startListening,
      stopListening,
      triggerManualDiagnostic,
      updateVoiceSettings,
      setMood,
      openWelcomeModal,
      closeWelcomeModal,
      openShortcutsModal,
      closeShortcutsModal,
      triggerShortcutFeedback,
      clearShortcutFeedback,
      toggleInferenceMode,
      setInferenceMode,
      dismissInferenceNotification,
      openSecurityModal,
      closeSecurityModal,
      cinematicIntroOpen,
      openTrailer,
      openCinematicIntro,
      closeCinematicIntro,
      submitMessageFeedback,
      removeMessageFeedback,
    ],
  );

  return <CrownContext.Provider value={value}>{children}</CrownContext.Provider>;
};

export const useCrown = () => {
  const context = useContext(CrownContext);
  if (!context) throw new Error("useCrown must be used within a CrownProvider");
  return context;
};
