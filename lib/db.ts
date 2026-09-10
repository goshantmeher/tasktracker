import { Databases, ID, Query, type Models } from 'node-appwrite'
import { serverClient, DB } from './appwrite'

// NOTE: written against node-appwrite's `Databases` API. If the installed SDK
// exposes `TablesDB` instead, see Task 1 Step 2 for the name translation.
const db = () => new Databases(serverClient())

import type { Project } from './shared'
export type { Project }

// Models.Document has no field index signature; DefaultDocument does, and is
// what listDocuments/createDocument/updateDocument actually resolve to when
// called without an explicit generic (as every call in this file does).
const toProject = (d: Models.DefaultDocument): Project => ({
  id: d.$id,
  name: d.name as string,
  slug: d.slug as string,
  archived: Boolean(d.archived),
})

export function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
}

export async function listProjects(): Promise<Project[]> {
  const res = await db().listDocuments(DB, 'projects', [
    Query.orderAsc('name'),
    Query.limit(100),
  ])
  const all = res.documents.map(toProject)
  // Archived sort below the rest, per the spec.
  return [...all.filter(p => !p.archived), ...all.filter(p => p.archived)]
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  const res = await db().listDocuments(DB, 'projects', [Query.equal('slug', slug), Query.limit(1)])
  return res.documents[0] ? toProject(res.documents[0]) : null
}

export async function createProject(name: string): Promise<Project> {
  const doc = await db().createDocument(DB, 'projects', ID.unique(), {
    name,
    slug: slugify(name),
    archived: false,
  })
  return toProject(doc)
}

export async function setArchived(id: string, archived: boolean): Promise<void> {
  await db().updateDocument(DB, 'projects', id, { archived })
}

// Not in the original task interface list; added for the probe script's
// cleanup and because later tasks will want it too.
export async function deleteProject(id: string): Promise<void> {
  await db().deleteDocument(DB, 'projects', id)
}
