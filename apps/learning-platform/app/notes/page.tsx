import { MessageSquareText } from 'lucide-react'
import Link from 'next/link'

import { AnnotationMarkdown } from '@/components/annotation-markdown'
import { rowToAnnotation } from '@/lib/annotations'
import { requireAdminPage } from '@/lib/auth'
import { listSpaces } from '@/lib/catalog'
import { getDatabase } from '@/lib/db'

export const dynamic = 'force-dynamic'

export default async function NotesPage() {
  await requireAdminPage('/notes')
  const spaces = await listSpaces({ includeUnpublished: true })
  const spaceById = new Map(spaces.map((space) => [space.id, space]))
  const rows = getDatabase().prepare('SELECT * FROM annotations ORDER BY updated_at DESC').all() as Array<Record<string, string>>
  const annotations = rows.map(rowToAnnotation)
  return (
    <main className="page-shell compact-page">
      <header className="page-heading"><p className="eyebrow"><MessageSquareText size={15} /> PRIVATE NOTES</p><h1>批注工作台</h1><p>集中查看所有模块中的疑问、判断和待验证事项。</p></header>
      <nav className="filter-row"><span className="active">全部 {annotations.length}</span><span>孤立 {annotations.filter((item) => item.status === 'orphaned').length}</span><span>已解决 {annotations.filter((item) => item.status === 'resolved').length}</span></nav>
      {annotations.length === 0 ? <div className="empty-state">还没有批注。进入任意文章，选中文字后点击“批注”即可建立第一条笔记。</div> : (
        <section className="notes-grid">{annotations.map((annotation) => {
          const space = spaceById.get(annotation.spaceId)
          return <article key={annotation.id}><div><span>{space?.title ?? annotation.spaceId}</span><b>{annotation.status}</b></div><blockquote>“{annotation.target.quote.exact}”</blockquote><AnnotationMarkdown body={annotation.body} />{space && <Link href={`/spaces/${space.slug}/learn/${annotation.documentId}`}>返回原文</Link>}</article>
        })}</section>
      )}
    </main>
  )
}
