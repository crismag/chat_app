/*
 * Icons Notes needs and the rest of the app does not.
 *
 * The shell's nav needs one extra mark; the page needs pin and archive. Those
 * do not belong in `shared/ui/icons.tsx` — five more icons there for one
 * feature is how that file becomes a graveyard. The nav imports `NotesIcon`
 * from here.
 */

type IconProps = { className?: string }

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
}

/** A folded page — Notes in the shell, not a C.H.A.T. section. */
export function NotesIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7 3.5h7.5L19 8v11.5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-14a2 2 0 0 1 2-2Z" />
      <path d="M14.5 3.5V8H19" />
      <path d="M8 12h8M8 16h5" />
    </svg>
  )
}

export function PinIcon({ className, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base} className={className} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 17v4" />
      <path d="M8.5 3.5h7l-1 7.5H18L12 17 6 11h3.5Z" />
    </svg>
  )
}

export function ArchiveIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 7.5h17v10a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10Z" />
      <path d="M2.5 4.5h19v3h-19Z" />
      <path d="M10 12.5h4" />
    </svg>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 7h14M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M8 7l.7 12.5h6.6L16 7" />
    </svg>
  )
}

export function RestoreIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 4.5v4h4" />
    </svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  )
}
