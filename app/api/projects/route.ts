import { requireCaller, isResponse, json } from '../_util'
import { listProjects } from '@/lib/db'

export async function GET(req: Request) {
  const caller = await requireCaller(req)
  if (isResponse(caller)) return caller
  const projects = (await listProjects()).filter(p => !p.archived)
  return json({ projects: projects.map(p => ({ id: p.id, name: p.name, slug: p.slug })) })
}
