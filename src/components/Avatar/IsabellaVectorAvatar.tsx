import "react";

export interface IsabellaVectorAvatarProps {
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | number;
  className?: string;
  mood?: string;
  animated?: boolean;
  showAura?: boolean;
}

const SIZE_MAP: Record<"sm" | "md" | "lg" | "xl" | "2xl", number> = {
  sm: 28,
  md: 40,
  lg: 56,
  xl: 72,
  "2xl": 120,
};

export function IsabellaVectorAvatar({
  size = "md",
  className = "",
  mood = "serena",
  animated = true,
  showAura = true,
}: IsabellaVectorAvatarProps) {
  const dimensions = typeof size === "number" ? size : (SIZE_MAP[size] ?? SIZE_MAP.md);
  const auroraOpacity = showAura ? 1 : 0;

  return (
    <div
      className={`relative inline-flex shrink-0 items-center justify-center ${animated ? "animate-[float-y_6s_ease-in-out_infinite]" : ""} ${className}`}
      style={{ width: dimensions, height: dimensions }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 120 120"
        width={dimensions}
        height={dimensions}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="aurora" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#e0bb5d" stopOpacity="0.55" />
            <stop offset="45%" stopColor="#c98e7a" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#0b1c35" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="medallion" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f2ba57" />
            <stop offset="50%" stopColor="#e0bb5d" />
            <stop offset="100%" stopColor="#c98e7a" />
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx="60" cy="60" r="58" fill="url(#aurora)" opacity={auroraOpacity} />
        <circle
          cx="60"
          cy="60"
          r="52"
          stroke="url(#medallion)"
          strokeWidth="2.5"
          fill="rgba(7, 9, 13, 0.82)"
          filter="url(#glow)"
        />
        <circle
          cx="60"
          cy="60"
          r="44"
          stroke="rgba(224, 187, 93, 0.38)"
          strokeWidth="1"
          strokeDasharray="3 5"
          fill="none"
        />

        {/* Sovereign profile silhouette — gold line-art */}
        <g stroke="url(#medallion)" strokeWidth="1.8" strokeLinecap="round" fill="none">
          {/* Crown of 5 points — identity */}
          <path d="M 36 46 L 44 38 L 50 44 L 60 32 L 70 44 L 76 38 L 84 46 Z" />
          {/* Hair / mantle */}
          <path d="M 30 60 C 30 48, 40 36, 60 36 C 80 36, 90 48, 90 60 L 90 80 C 90 86, 84 92, 76 94 L 60 100 L 44 94 C 36 92, 30 86, 30 80 Z" />
          {/* Face oval */}
          <ellipse cx="60" cy="60" rx="14" ry="16" />
          {/* Eyes */}
          <circle cx="54.5" cy="59" r="1.25" fill="#e0bb5d" />
          <circle cx="65.5" cy="59" r="1.25" fill="#e0bb5d" />
          {/* Mouth */}
          <path d="M 55 68 Q 60 71, 65 68" />
          {/* Sovereign medallion chest */}
          <circle cx="60" cy="90" r="5.5" />
        </g>

        {/* Mood hint — 3 tiny stars */}
        {mood === "serena" || mood === "curiosa" ? (
          <g fill="#e0bb5d" opacity="0.86">
            <circle cx="32" cy="32" r="1.3" />
            <circle cx="88" cy="34" r="1.1" />
            <circle cx="60" cy="20" r="1.0" />
          </g>
        ) : (
          <g stroke="#c98e7a" strokeWidth="1.2" opacity="0.7">
            <path d="M 28 30 L 34 34 M 34 30 L 30 34" />
            <path d="M 86 32 L 92 36 M 92 32 L 86 36" />
          </g>
        )}

        {/* Terracotta terroir ring at bottom — territorial identity */}
        <path
          d="M 26 82 C 34 96, 50 104, 60 104 C 70 104, 86 96, 94 82"
          stroke="rgba(201, 142, 122, 0.72)"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </div>
  );
}

export default IsabellaVectorAvatar;
