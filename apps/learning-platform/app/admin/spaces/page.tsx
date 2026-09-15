import { Plus } from 'lucide-react'
import Link from 'next/link'

import { AdminNav } from '@/components/admin-nav'
import { SpaceStatusControl } from '@/components/space-status-control'
import { requireAdminPage } from '@/lib/auth'
import { listSpaces } from '@/lib/catalog'
import { listDocuments } from '@/lib/content'

export const dynamic = 'force-dynamic'

export default async function AdminSpacesPage() {
  await requireAdminPage('/admin/spaces')
  const spaces = await listSpaces({ includeUnpublished: true })
  const rows = await Promise.all(spaces.map(async (space) => ({ ...space, documentCount: (await listDocuments(space, { includeUnpublished: true })).length })))
  return <main className="page-shell compact-page admin-page"><AdminNav /><header className="section-heading"><div><p className="eyebrow">CONTENT ADMIN</p><h1>学习空间</h1></div><Link className="primary-button" href="/admin/spaces/new"><Plus size={17} />新建模块</Link></header><div className="admin-space-list">{rows.map((space) => <article key={space.id}><div><span className={`status-badge status-${space.status}`}>{space.status}</span><h2><Link href={`/admin/spaces/${space.slug}`}>{space.title}</Link></h2><p>{space.category} · {space.documentCount} 篇 · <code>{space.contentRoot}</code></p></div><SpaceStatusControl spaceId={space.id} status={space.status} /></article>)}</div></main>
}
