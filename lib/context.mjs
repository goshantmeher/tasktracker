const OPEN = ['in_progress', 'blocked', 'todo', 'backlog']
const HEADING = {
  in_progress: 'In Progress', blocked: 'Blocked', todo: 'Todo', backlog: 'Backlog',
}
const BODY_FIELDS = [
  ['description', 'Description'],
  ['requirement', 'Requirement'],
  ['prerequisites', 'Prerequisites'],
]

/**
 * The whole board as one markdown document for an agent to read at the start
 * of a session. Pure: takes plain objects, returns a string, touches nothing.
 *
 * @param {{project: {name: string, slug: string},
 *          tasks: Array<object>,
 *          logByTask: Map<string, Array<{author: string, body: string, createdAt: string}>>}} input
 * @returns {string}
 */
export function renderContext({ project, tasks, logByTask = new Map() }) {
  // The slug, not just the name, because an agent acting on this briefing
  // needs it verbatim for every follow-up call (?project=<slug>).
  const out = [`# ${project.name} (\`${project.slug}\`)`, '']

  // 1. Keep in mind — every note, every status, done included. Leads the
  //    document because its purpose is to be read while working elsewhere.
  const noted = tasks.filter(t => t.notes && t.notes.trim())
  if (noted.length) {
    out.push('## Keep in mind', '')
    for (const t of noted) {
      out.push(`### ${t.title}${t.status === 'done' ? ' (done)' : ''} \`${t.id}\``, '', t.notes.trim(), '')
    }
  }

  // 2. Open tasks, grouped by status in working order.
  out.push('## Open tasks', '')
  const open = tasks.filter(t => OPEN.includes(t.status))
  if (open.length === 0) {
    out.push('No open tasks.', '')
  } else {
    for (const status of OPEN) {
      const group = open.filter(t => t.status === status).sort((a, b) => a.order - b.order)
      if (!group.length) continue
      out.push(`### ${HEADING[status]}`, '')
      for (const t of group) {
        const meta = [t.type, t.priority, t.assignee || null, ...(t.labels || [])]
          .filter(Boolean).join(' · ')
        out.push(`#### ${t.title}`, '', `\`${t.id}\` — ${meta}`, '')
        for (const [field, label] of BODY_FIELDS) {
          if (t[field] && t[field].trim()) {
            out.push(`**${label}:**`, '', t[field].trim(), '')
          }
        }
        for (const entry of logByTask.get(t.id) || []) {
          out.push(`> *${entry.author}, ${entry.createdAt}* — ${entry.body.trim()}`, '')
        }
      }
    }
  }

  // 3. Done — titles and results only. Full bodies of finished work are
  //    noise. The id still rides along (in a code span, like every other
  //    task reference in this document) so a task that just moved to Done
  //    can still be looked up for a follow-up write.
  const done = tasks.filter(t => t.status === 'done')
  if (done.length) {
    out.push('## Done', '')
    for (const t of done) {
      out.push(t.result && t.result.trim()
        ? `- **${t.title}** \`${t.id}\` — ${t.result.trim().replace(/\n+/g, ' ')}`
        : `- **${t.title}** \`${t.id}\``)
    }
    out.push('')
  }

  return out.join('\n')
}
