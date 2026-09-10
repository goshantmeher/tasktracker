// The board's visual vocabulary: issue key, issue-type icon, priority icon,
// assignee avatar, status lozenge. Pure presentation — no imports beyond
// React types, so client and server components can both use it. Keep it that
// way: board.tsx and detail.tsx are 'use client', and anything this file
// imported would be pulled into the browser bundle with them.

const TYPE_STYLE: Record<string, { bg: string; glyph: string; label: string }> = {
  // Colour and glyph both carry the type: a red dot for a bug, a green bar
  // for a feature, a blue tick for a chore.
  bug: { bg: '#e5493a', glyph: '●', label: 'Bug' },
  feature: { bg: '#65ba43', glyph: '▬', label: 'Feature' },
  chore: { bg: '#4bade8', glyph: '✓', label: 'Chore' },
}

export function TypeIcon({ type, size = 16 }: { type: string; size?: number }) {
  const s = TYPE_STYLE[type] ?? TYPE_STYLE.chore
  return (
    <span
      title={s.label}
      aria-label={s.label}
      style={{ background: s.bg, width: size, height: size, fontSize: size * 0.6 }}
      className="inline-flex shrink-0 items-center justify-center rounded-[3px] font-bold leading-none text-white"
    >
      {s.glyph}
    </span>
  )
}

// Priority is a directional arrow, not a coloured dot: up for above-normal,
// a bar for medium, down for low. Colour alone would be
// invisible to a colourblind reader, which is why the shape carries it too —
// hence urgent's doubled triangle rather than just a darker red one.
//
// Every glyph here must be a text-presentation character. U+23EB (⏫) was the
// obvious pick for urgent and rendered as a full-colour emoji instead,
// ignoring `color` entirely and showing up as a blue box on the card.
const PRIORITY_STYLE: Record<string, { color: string; glyph: string; label: string }> = {
  urgent: { color: '#ae2e24', glyph: '▲▲', label: 'Urgent' },
  high: { color: '#e5493a', glyph: '▲', label: 'High' },
  medium: { color: '#e9a23b', glyph: '▬', label: 'Medium' },
  low: { color: '#2a8735', glyph: '▼', label: 'Low' },
}

export function PriorityIcon({ priority }: { priority: string }) {
  const s = PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.medium
  return (
    <span
      title={`${s.label} priority`}
      aria-label={`${s.label} priority`}
      style={{ color: s.color }}
      className="inline-block shrink-0 tracking-[-0.1em] text-[10px] leading-none"
    >
      {s.glyph}
    </span>
  )
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  backlog: { bg: '#dcdfe4', fg: '#42526e', label: 'Backlog' },
  todo: { bg: '#dcdfe4', fg: '#42526e', label: 'To Do' },
  in_progress: { bg: '#deebff', fg: '#0055cc', label: 'In Progress' },
  blocked: { bg: '#ffecea', fg: '#ae2e24', label: 'Blocked' },
  done: { bg: '#dcfff1', fg: '#216e4e', label: 'Done' },
}

/** Status pill: tiny, uppercase, tinted background. */
export function StatusLozenge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.todo
  return (
    <span
      style={{ background: s.bg, color: s.fg }}
      className="inline-block rounded-[3px] px-1.5 py-0.5 text-[11px] font-bold uppercase leading-4 tracking-tight"
    >
      {s.label}
    </span>
  )
}

// Deterministic avatar colour: the same person is the same colour on every
// card and every reload, without storing anything.
const AVATAR_COLORS = [
  '#0052cc', '#0747a6', '#00a3bf', '#00875a', '#5243aa',
  '#bf2600', '#de350b', '#ff8b00', '#6554c0', '#008da6',
]

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s._@-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  if (!name.trim()) {
    // A soft grey silhouette, not an outline or a question mark — an
    // unassigned card should recede, not ask the reader a question.
    return (
      <span
        title="Unassigned"
        aria-label="Unassigned"
        style={{ width: size, height: size, fontSize: size * 0.62 }}
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#dcdfe4] leading-none text-[#8993a4]"
      >
        <svg viewBox="0 0 24 24" width={size * 0.68} height={size * 0.68} fill="currentColor" aria-hidden>
          <circle cx="12" cy="8" r="4" />
          <path d="M12 14c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z" />
        </svg>
      </span>
    )
  }
  return (
    <span
      title={name}
      aria-label={name}
      style={{
        background: AVATAR_COLORS[hashCode(name) % AVATAR_COLORS.length],
        width: size,
        height: size,
        fontSize: size * 0.42,
      }}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none text-white"
    >
      {initials(name)}
    </span>
  )
}

/**
 * The short issue key (`SCRA-8E8F`). Derived from the project slug and the
 * tail of the Appwrite document id rather than stored: a counted key needs a
 * per-project sequence row and a race on every create, to buy nothing this
 * board uses. Derived keys are stable, unique
 * (the id already is), and free.
 *
 * ponytail: derived key, add a real `number` column if anyone ever needs to
 * quote "SCRA-42" to a human and have it be the 42nd task.
 */
export function issueKey(slug: string, id: string): string {
  return `${slug.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase()}-${id.slice(-4).toUpperCase()}`
}
