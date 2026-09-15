import { ArrowRight, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AdminNav } from '@/components/admin-nav'
import { AdminSpaceMetadataForm } from '@/components/admin-space-metadata-form'
import { SpaceStatusControl } from '@/components/space-status-control'
import { requireAdminPage } from '@/lib/auth'
import { getSpace } from '@/lib/catalog'
import { listDocuments } from '@/lib/content'

export const dynamic = 'force-dynamic'

export default async function ManageSpacePage({ params }: { params: Promise<{ spaceSlug: string }> }) {
  const { spaceSlug } = await params
  await requireAdminPage(`/admin/spaces/${spaceSlug}`)
  const space = await getSpace(spaceSlug, { includeUnpublished: true })
  if (!space) notFound()
  const documents = await listDocuments(space, { includeUnpublished: true })
  return <main className="page-shell compact-page admin-page"><AdminNav /><header className="admin-space-heading"><div><p className="eyebrow">{space.category}</p><h1>{space.title}</h1><p><code>{space.contentRoot}</code></p></div><div><SpaceStatusControl spaceId={space.id} status={space.status} />{space.status === 'published' && <Link className="text-button" href={`/spaces/${space.slug}`}><ExternalLink size={15} />查看前台</Link>}</div></header><section className="admin-settings-section"><div><p className="eyebrow">SPACE SETTINGS</p><h2>模块设置</h2><p>修改元数据、首页精选状态与排序。slug 和内容根创建后保持稳定，以免破坏文章链接与批注身份。</p></div><AdminSpaceMetadataForm space={space} /></section><section className="document-section"><div className="section-heading"><div><p className="eyebrow">DOCUMENTS</p><h2>文章与草稿</h2></div><span>{documents.length} 篇</span></div><div className="document-list">{documents.map((document, index) => <Link href={`/admin/spaces/${space.slug}/edit/${document.slug}`} key={document.id}><span className="document-index">{String(index + 1).padStart(2, '0')}</span><div><strong>{document.title}</strong><p>{document.path}</p></div><div className="document-trailing"><span className={`status-badge status-${document.status}`}>{document.status}</span><ArrowRight size={17} /></div></Link>)}</div></section></main>
}
