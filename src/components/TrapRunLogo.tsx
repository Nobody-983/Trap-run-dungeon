import { type HTMLAttributes } from 'react'

export interface TrapRunLogoProps extends HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'full' | 'emblem' | 'compact'
  animate?: boolean
}

export function DungeonCrest({
  size = 32,
  className = '',
  animate = false,
}: {
  size?: number
  className?: string
  animate?: boolean
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 transition-transform ${animate ? 'hover:scale-105' : ''} ${className}`}
      aria-label="Trap Run Dungeon Crest"
    >
      <defs>
        <linearGradient id="crestVolt" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#cfa6ff" />
          <stop offset="100%" stopColor="#9d4dff" />
        </linearGradient>
        <linearGradient id="crestAcid" x1="16" y1="16" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#d4ff7a" />
          <stop offset="100%" stopColor="#8fd116" />
        </linearGradient>
        <filter id="crestGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Outer Shield Frame */}
      <polygon
        points="32,4 58,18 58,46 32,60 6,46 6,18"
        fill="#0c0c12"
        stroke="url(#crestVolt)"
        strokeWidth="3"
        strokeLinejoin="round"
      />

      {/* Chamber Inset */}
      <polygon
        points="32,10 52,21 52,43 32,54 12,43 12,21"
        fill="#13131d"
        stroke="#262638"
        strokeWidth="1.5"
      />

      {/* Spiked Portcullis Hazards */}
      <path
        d="M20 20 L24 28 L28 20 L32 28 L36 20 L40 28 L44 20"
        stroke="url(#crestVolt)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 44 L24 36 L28 44 L32 36 L36 44 L40 36 L44 44"
        stroke="url(#crestVolt)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Escaping Runner Glyph */}
      <g filter="url(#crestGlow)">
        <polygon points="32,22 42,32 32,42 35,32" fill="url(#crestAcid)" />
        <polygon points="22,32 32,22 29,32" fill="#b9ff3b" opacity="0.9" />
        <circle cx="32" cy="32" r="3.5" fill="#ffffff" />
      </g>

      {/* Corner Nodes */}
      <circle cx="6" cy="18" r="2.5" fill="#b9ff3b" />
      <circle cx="58" cy="18" r="2.5" fill="#b9ff3b" />
      <circle cx="32" cy="60" r="2.5" fill="#b9ff3b" />
    </svg>
  )
}

export function TrapRunLogo({
  size = 'md',
  variant = 'full',
  animate = true,
  className = '',
  ...props
}: TrapRunLogoProps) {
  const crestSizes = {
    sm: 24,
    md: 32,
    lg: 48,
    xl: 68,
  }

  const textSizes = {
    sm: 'text-base',
    md: 'text-lg',
    lg: 'text-3xl',
    xl: 'text-5xl sm:text-7xl',
  }

  const crestSize = crestSizes[size]

  if (variant === 'emblem') {
    return (
      <div className={`inline-flex items-center ${className}`} {...props}>
        <DungeonCrest size={crestSize} animate={animate} />
      </div>
    )
  }

  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`} {...props}>
      <DungeonCrest size={crestSize} animate={animate} />
      <div className="flex flex-col leading-none">
        <div className={`font-pixel font-bold tracking-tight ${textSizes[size]}`}>
          <span className="text-zinc-50">TRAP</span>
          <span className="text-volt-400 drop-shadow-[0_0_12px_rgba(157,77,255,.9)]">//</span>
          <span className="text-acid-500 drop-shadow-[0_0_12px_rgba(185,255,59,.7)]">RUN</span>
        </div>
        {size !== 'sm' && variant !== 'compact' && (
          <span className="mt-1 font-pixel text-[9px] uppercase tracking-[0.18em] text-zinc-400">
            Dungeon Challenge
          </span>
        )}
      </div>
    </div>
  )
}
