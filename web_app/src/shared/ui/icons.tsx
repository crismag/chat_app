/*
 * Inline SVG icons.
 *
 * Inline rather than an icon font or a package: five icons do not justify a
 * dependency, and inline paths inherit `currentColor`, so an icon is the same
 * colour as the label beside it in both themes without anyone maintaining a
 * second palette.
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

export function ChatIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-3.4-.6L3 21l1.8-4.4A8.3 8.3 0 0 1 3.6 11.5a8.4 8.4 0 0 1 8.4-8.4 8.4 8.4 0 0 1 9 8.4Z" />
    </svg>
  )
}

/** A person, for the profile — the one destination that is about who you are. */
export function ProfileIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </svg>
  )
}

export function LibraryIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
      <path d="M9 7h7" />
    </svg>
  )
}

export function CommunityIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" />
      <circle cx="10" cy="7.5" r="3.5" />
      <path d="M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.2a3.5 3.5 0 0 1 0 6.6" />
    </svg>
  )
}

export function SparkIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4.5 13.4 9l4.6 1.5-4.6 1.5L12 16.5 10.6 12 6 10.5 10.6 9 12 4.5Z" />
      <path d="M18 4v3M19.5 5.5h-3" />
    </svg>
  )
}

/*
 * A hand and a spark — wording the author wrote with the model's help.
 *
 * Between the plain pencil and the plain spark, so the three provenance marks
 * differ in shape and not only in colour.
 */
export function AssistedIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 20.5h4l9-9a2.8 2.8 0 0 0-4-4l-9 9v4Z" />
      <path d="M18.5 2.5 19.4 5l2.6.9-2.6.9-.9 2.6-.9-2.6L15 5l2.6-.9.9-2.4Z" />
    </svg>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7h16M10 4h4a1 1 0 0 1 1 1v2H9V5a1 1 0 0 1 1-1Z" />
      <path d="M6.5 7 7.4 19a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9L17.5 7" />
      <path d="M10.5 11v6M13.5 11v6" />
    </svg>
  )
}

export function ShareIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3v12" />
      <path d="m8 6.8 4-3.8 4 3.8" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  )
}

export function CreateIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4 10.1 12.8 4.5 10.9 10.1 9 12 3.5Z" />
      <path d="M18.5 16.5 19.2 18.4 21 19l-1.8.7-.7 1.8-.7-1.8L16 19l1.8-.6.7-1.9Z" />
    </svg>
  )
}

export function SignOutIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="m16 16 4-4-4-4M20 12H9" />
    </svg>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  )
}

/* Points the way the panel will move, so the control describes its own effect. */
export function CollapseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M15 6 9 12l6 6" />
    </svg>
  )
}

export function ExpandIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8.5 10.5V7.75a3.5 3.5 0 0 1 7 0v2.75" />
    </svg>
  )
}

export function GlobeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.2 2.4 3.3 5.3 3.3 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.3-5.3-3.3-8.5S9.8 5.9 12 3.5Z" />
    </svg>
  )
}

export function PencilIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function SendIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 12 20 4.5 15.5 20l-4-6.5-7-1.5Z" />
    </svg>
  )
}

export function BookIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H12v16H5.5A1.5 1.5 0 0 0 4 20.5v-16Z" />
      <path d="M20 4.5A1.5 1.5 0 0 0 18.5 3H12v16h6.5a1.5 1.5 0 0 1 1.5 1.5v-16Z" />
    </svg>
  )
}

/**
 * A document taking something in — the "use this response in my reflection"
 * mark.
 *
 * Deliberately not a bare plus. A plus alone says "add" without saying add
 * what, or where; a page with an arrow entering it says the response is going
 * into the thing being written.
 */
export function UseInIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9" />
      <path d="M12 12h7" />
      <path d="m16 9 3 3-3 3" />
    </svg>
  )
}
