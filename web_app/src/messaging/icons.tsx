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

/** Speech bubbles — Messages in the shell, not the Reflect composer. */
export function MessagesIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 6.5h10.5a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2H10l-3.5 2.5V17H5a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z" />
      <path d="M8 10h7M8 13h4" />
    </svg>
  )
}
