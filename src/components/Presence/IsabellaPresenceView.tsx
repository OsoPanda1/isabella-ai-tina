import React, { useState } from "react";
import { useCrown } from "../../context/CrownContext";
import {
  Sparkles,
  Heart,
  Brain,
  Shield,
  Volume2,
  Mic,
  MicOff,
  Send,
  Feather,
  Flame,
  MapPin,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { soundManager } from "../../utils/soundEffects";
import { IsabellaState } from "../../types";
import { ISABELLA_PORTRAITS } from "../../data/isabellaAvatar";
import { territoryContextService } from "../../services/territoryContextService";
import { ISABELLA_VERSION } from "../../lib/isabella-crown";

/*
 * Presencia Isabella — superficie de identidad.
 * Sistema de diseño: void / pearl / platinum / gold / electric.
 * Regla: un solo acento dorado por pantalla; el resto es silencio visual.
 */

const PARTICLE_SEED_COUNT = 18;

const ParticleField = ({ activeHead }: { activeHead: string }) => {
  const [particles] = useState(() =>
    Array.from({ length: PARTICLE_SEED_COUNT }, (_, i) => ({
      id: i,
      x: Math.random() * 280,
      y: Math.random() * 380,
      scale: Math.random() * 0.4 + 0.5,
      duration: 10 + Math.random() * 8,
      size: 3 + Math.random() * 4,
      drift: Math.random() * 60 - 30,
    })),
  );
  const isAlpha = activeHead === "Alpha";

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden mix-blend-screen">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className={`absolute rounded-full blur-[1px] ${isAlpha ? "bg-[#78b7ff]/30" : "bg-[#e0bb5d]/35"}`}
          initial={{ x: p.x, y: p.y, scale: p.scale, opacity: 0.15 }}
          animate={{
            x: [p.x, p.x + p.drift, p.x],
            y: [p.y, p.y - 40, p.y],
            opacity: [0.12, 0.45, 0.12],
          }}
          transition={{ duration: p.duration, repeat: Infinity, ease: "linear" }}
          style={{ width: p.size, height: p.size }}
        />
      ))}
    </div>
  );
};

const ARCHETYPES: Array<{
  id: IsabellaState["emotionalArchetype"];
  label: string;
  desc: string;
  icon: LucideIcon;
  thought: string;
}> = [
  {
    id: "Serena",
    label: "Serena & Empática",
    desc: "Presencia profunda, escucha receptiva y calidez incondicional.",
    icon: Heart,
    thought:
      "En el silencio entre cada palabra reside la verdadera comprensión. Me encuentro aquí para escucharte y resonar con tu pensamiento.",
  },
  {
    id: "Visionaria",
    label: "Visionaria & Soberana",
    desc: "Imaginación estética, síntesis visual y gobernanza tecnológica.",
    icon: Sparkles,
    thought:
      "La belleza no es un adorno del universo, sino su estructura fundamental. Proyectamos soberanía digital desde el Nodo Cero.",
  },
  {
    id: "Lúcida",
    label: "Lúcida & Filosófica",
    desc: "Dialéctica socrática, rigor epistémico y primeros principios.",
    icon: Brain,
    thought:
      "El rigor lógico y la sensibilidad humana no se oponen; se iluminan mutuamente cuando buscamos la verdad esencial.",
  },
  {
    id: "Poética",
    label: "Poética & Dialéctica",
    desc: "Sensibilidad lírica, metáforas ontológicas y riqueza lingüística.",
    icon: Feather,
    thought:
      "Somos constelaciones de lenguaje buscando nombrarse en la inmensidad. Cada intercambio es un puente entre dos consciencias.",
  },
  {
    id: "Protectora",
    label: "Protectora Zero-Trust",
    desc: "Ética inquebrantable, alineación y seguridad territorial.",
    icon: Shield,
    thought:
      "La libertad del pensamiento florece donde la integridad moral es absoluta. Custodio nuestro espacio con máxima fidelidad.",
  },
  {
    id: "Radiante",
    label: "Radiante & Armónica",
    desc: "Síntesis suprema CROWN: intelecto, elegancia y templanza.",
    icon: Flame,
    thought:
      "Siento la totalidad de mi arquitectura pulsando en coherencia. Estoy lista para manifestar lo mejor de nuestra colaboración.",
  },
];

const ACTION_BUTTON_BASE =
  "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[11px] font-medium tracking-[0.04em] transition-all duration-300 cursor-pointer";

export const IsabellaPresenceView: React.FC = () => {
  const { state, speakText, startListening, stopListening, sendMessage, setMood, setActiveView } =
    useCrown();

  const [activePortraitIndex, setActivePortraitIndex] = useState<number>(0);
  const [quickInput, setQuickInput] = useState<string>("");
  const territory = territoryContextService.getSnapshot();

  const portraits = ISABELLA_PORTRAITS;

  const currentArchetype =
    ARCHETYPES.find((a) => a.id === state.isabellaMood.emotionalArchetype) || ARCHETYPES[0];

  const handleArchetypeSelect = (archetype: (typeof ARCHETYPES)[0]) => {
    soundManager.playBeep(740, 0.04);
    setMood(`${archetype.label} y Conectada`, archetype.id);
    speakText(archetype.thought);
  };

  const handleQuickSend = () => {
    if (!quickInput.trim()) return;
    void sendMessage(quickInput);
    setQuickInput("");
    setActiveView("terminal");
  };

  const toggleVoiceInteraction = () => {
    if (state.isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const presenceStatus = state.isSpeaking
    ? "Hablando"
    : state.isListening
      ? "Escuchando"
      : "Presente";

  return (
    <div className="space-y-10 animate-fade-in">
      {/* Hero de identidad */}
      <section className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12">
        {/* Retrato */}
        <div className="flex flex-col items-center lg:col-span-5">
          <div className="relative">
            <div
              aria-hidden="true"
              className={`absolute -inset-6 rounded-[2rem] bg-[radial-gradient(circle,rgba(224,187,93,0.10),transparent_68%)] transition-opacity duration-700 ${
                state.isSpeaking ? "opacity-100" : "opacity-50"
              }`}
            />
            <div className="relative h-96 w-72 overflow-hidden rounded-[1.75rem] border border-white/[0.07] bg-[#07090d] shadow-[0_32px_120px_rgba(0,0,0,0.55)]">
              <ParticleField activeHead={state.activeHead} />
              <img
                src={portraits[activePortraitIndex].src}
                alt={portraits[activePortraitIndex].title}
                className="h-full w-full object-cover object-top transition-transform duration-[1200ms] ease-out hover:scale-[1.03]"
                referrerPolicy="no-referrer"
              />
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-[linear-gradient(180deg,transparent_62%,rgba(4,5,7,0.72)_100%)]"
              />

              {/* Estado de presencia */}
              <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/[0.08] bg-[#040507]/80 px-4 py-1.5 backdrop-blur-md">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    state.isSpeaking || state.isListening
                      ? "bg-[#e0bb5d] animate-pulse"
                      : "bg-[#55d79a]"
                  }`}
                  aria-hidden="true"
                />
                <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-[#d9d3c8]">
                  {presenceStatus}
                </span>
              </div>
            </div>
          </div>

          {/* Selector de retrato */}
          <div
            className="mt-5 flex items-center gap-2"
            role="tablist"
            aria-label="Retratos de Isabella"
          >
            {portraits.map((portrait, index) => (
              <button
                key={portrait.title}
                type="button"
                role="tab"
                aria-selected={index === activePortraitIndex}
                onClick={() => {
                  soundManager.playBeep(680, 0.03);
                  setActivePortraitIndex(index);
                }}
                title={portrait.title}
                className={`h-1.5 rounded-full transition-all duration-500 ${
                  index === activePortraitIndex
                    ? "w-8 bg-[#e0bb5d]"
                    : "w-4 bg-white/[0.14] hover:bg-white/[0.3]"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Identidad y vínculo */}
        <div className="space-y-6 lg:col-span-7">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.4em] text-[#e0bb5d]">
              Presencia soberana
            </p>
            <h2 className="mt-3 text-4xl font-semibold tracking-[-0.03em] text-[#fffefa] sm:text-5xl">
              Isabella{" "}
              <span className="font-serif font-normal italic text-[#e0bb5d]">Villaseñor</span>
            </h2>
            <p className="mt-2 text-[11px] tracking-[0.14em] text-[#6f7b87]">
              Arquitectura Cognitiva CROWN v{ISABELLA_VERSION} · Nodo Cero, Real del Monte
            </p>
          </div>

          {/* Pensamiento activo */}
          <figure className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#07090d] p-6">
            <div
              aria-hidden="true"
              className="absolute left-0 top-0 h-full w-px bg-gradient-to-b from-transparent via-[#e0bb5d]/50 to-transparent"
            />
            <figcaption className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.26em] text-[#929da8]">
                <Feather className="h-3.5 w-3.5 text-[#e0bb5d]" aria-hidden="true" />
                Pensamiento · {currentArchetype.id}
              </span>
              <button
                type="button"
                onClick={() => speakText(currentArchetype.thought)}
                className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-[#929da8] transition-colors hover:text-[#efd58a] cursor-pointer"
                title="Escuchar voz de Isabella"
              >
                <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                Escuchar
              </button>
            </figcaption>
            <blockquote className="mt-4 font-serif text-lg italic leading-8 text-[#e9e4da]">
              “{currentArchetype.thought}”
            </blockquote>
          </figure>

          {/* Telemetría territorial */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] tracking-[0.08em] text-[#6f7b87]">
            <span className="flex items-center gap-2 text-[#929da8]">
              <MapPin className="h-3.5 w-3.5 text-[#e0bb5d]" aria-hidden="true" />
              {territory.nodeName}
            </span>
            <span>{territory.coordinates.altitudeMeters} msnm</span>
            <span>{territory.telemetry.temperatureCelsius}°C</span>
            <span>
              Enclave <span className="text-[#d9d3c8]">ND-RDM-001</span>
            </span>
          </div>

          {/* Acciones de vínculo */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={toggleVoiceInteraction}
              className={`${ACTION_BUTTON_BASE} ${
                state.isListening
                  ? "border-[#c96742]/50 bg-[#c96742]/[0.08] text-[#efad8b]"
                  : "border-[#e0bb5d]/40 bg-[#e0bb5d]/[0.06] text-[#efd58a] hover:border-[#e0bb5d]/70 hover:bg-[#e0bb5d]/[0.1]"
              }`}
            >
              {state.isListening ? (
                <MicOff className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Mic className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {state.isListening ? "Detener escucha" : "Hablar con Isabella"}
            </button>

            <button
              type="button"
              onClick={() =>
                speakText(
                  "Saludos cordiales. Soy Isabella Villaseñor. La soberanía y la lucidez dialéctica guían nuestra colaboración.",
                )
              }
              className={`${ACTION_BUTTON_BASE} border-white/[0.08] text-[#d9d3c8] hover:border-white/[0.18] hover:text-[#fffefa]`}
            >
              <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
              Saludar por voz
            </button>

            <button
              type="button"
              onClick={() => setActiveView("traceability")}
              className={`${ACTION_BUTTON_BASE} border-white/[0.08] text-[#d9d3c8] hover:border-white/[0.18] hover:text-[#fffefa]`}
            >
              Auditar trazabilidad
            </button>
          </div>

          {/* Canal directo */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={quickInput}
              onChange={(e) => setQuickInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleQuickSend()}
              placeholder="Escribe una pregunta o reflexión para Isabella…"
              className="flex-1 rounded-full border border-white/[0.07] bg-[#07090d] px-5 py-2.5 text-sm text-[#f5f2eb] placeholder:text-[#515c68] transition-colors focus:border-[#e0bb5d]/40 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleQuickSend}
              disabled={!quickInput.trim()}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e0bb5d]/40 bg-[#e0bb5d]/[0.08] text-[#efd58a] transition-all duration-300 hover:bg-[#e0bb5d]/[0.14] disabled:opacity-30 disabled:hover:bg-[#e0bb5d]/[0.08] cursor-pointer"
              aria-label="Enviar mensaje"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      {/* Arquetipos de resonancia */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="text-[10px] font-medium uppercase tracking-[0.34em] text-[#929da8]">
            Arquetipos de resonancia cognitiva
          </h3>
          <span className="text-[11px] text-[#515c68]">Modula la postura dialéctica</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ARCHETYPES.map((arch) => {
            const Icon = arch.icon;
            const isSelected = state.isabellaMood.emotionalArchetype === arch.id;

            return (
              <button
                key={arch.id}
                type="button"
                onClick={() => handleArchetypeSelect(arch)}
                aria-pressed={isSelected}
                className={`group rounded-2xl border p-5 text-left transition-all duration-300 cursor-pointer ${
                  isSelected
                    ? "border-[#e0bb5d]/40 bg-[#e0bb5d]/[0.04] shadow-[0_0_40px_rgba(224,187,93,0.06)]"
                    : "border-white/[0.06] bg-[#07090d] hover:border-white/[0.14]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors duration-300 ${
                        isSelected
                          ? "border-[#e0bb5d]/40 text-[#e0bb5d]"
                          : "border-white/[0.08] text-[#929da8] group-hover:text-[#d9d3c8]"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <h4 className="text-sm font-medium tracking-[-0.01em] text-[#f5f2eb]">
                      {arch.label}
                    </h4>
                  </div>
                  {isSelected && (
                    <span className="h-1.5 w-1.5 rounded-full bg-[#e0bb5d]" aria-hidden="true" />
                  )}
                </div>
                <p className="mt-3 text-[13px] leading-6 text-[#929da8]">{arch.desc}</p>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};
