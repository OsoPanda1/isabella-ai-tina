/**
 * Isabella Cinematic Intro — Color Palette
 *
 * Paleta canónica del intro cinematográfico.
 * Jerarquía: Void → Deep Space → Core → Life → Brand
 */

export const COLORS = {
  voidBlack: "#02040A",
  deepSpace: "#07111F",
  indigoCore: "#312E81",
  electricViolet: "#8B5CF6",
  cyanSignal: "#22D3EE",
  roseHeart: "#FB7185",
  emeraldLife: "#34D399",
  goldAccent: "#FACC15",
  whiteLight: "#F8FAFC",
} as const;

export const COLORS_THREE = {
  voidBlack: 0x02040a,
  deepSpace: 0x07111f,
  indigoCore: 0x312e81,
  electricViolet: 0x8b5cf6,
  cyanSignal: 0x22d3ee,
  roseHeart: 0xfb7185,
  emeraldLife: 0x34d399,
  goldAccent: 0xfacc15,
  whiteLight: 0xf8fafc,
} as const;

export const STAR_LAYERS = {
  distant: { color: 0xffffff, size: 0.8, opacity: 0.4, speed: 0.02 },
  mid: { color: 0xddeeff, size: 1.2, opacity: 0.6, speed: 0.05 },
  near: { color: 0xaaccff, size: 1.8, opacity: 0.8, speed: 0.1 },
  bright: { color: 0x88ccff, size: 2.5, opacity: 1.0, speed: 0.15 },
} as const;

export const COMET_COLORS = [
  COLORS_THREE.cyanSignal,
  COLORS_THREE.electricViolet,
  COLORS_THREE.goldAccent,
] as const;
