import { ArrowLeft, Clock3, FileText, MessageSquareText } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { AnnotationPanel } from '@/components/annotation-panel'
import { ProgressControl } from '@/components/progress-control'
import type { DocumentMeta, LearningDocument, LearningSpace } from '@/lib/types'

export function ArticleLayout({
  space,
  document,
  documents,
  isOwner,
  children,
}: {
  space: LearningSpace
  document: LearningDocument
  documents: DocumentMeta[]
  isOwner: boolean
  children: ReactNode
}) {
  return (
    <main className="reader-shell">
      <aside className="reader-sidebar">
        <Link className="back-link" href={`/spaces/${space.slug}`}><ArrowLeft size={16} />{space.title}</Link>
        <p className="rail-label">模块目录</p>
        <nav aria-label={`${space.title} 文章目录`}>
          {documents.map((item) => (
            <Link className={item.id === document.id ? 'active' : ''} key={item.id} href={`/spaces/${space.slug}/learn/${item.slug}`}>
              <FileText size={15} />
              <span>{item.title}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <article className="learning-article" id="learning-article">
        <div className="article-breadcrumbs"><Link href="/spaces">学习空间</Link><span>/</span><Link href={`/spaces/${space.slug}`}>{space.title}</Link></div>
        <header className="article-header">
          <span className="category-label">{space.category}</span>
          <h1>{document.title}</h1>
          <p>{document.summary}</p>
          <div className="article-meta">
            {document.estimatedMinutes && <span><Clock3 size={15} />约 {document.estimatedMinutes} 分钟</span>}
            <span>内容版本 {document.revision.slice(0, 8)}</span>
            {isOwner && <ProgressControl spaceSlug={space.slug} documentId={document.id} />}
          </div>
        </header>
        <div className="prose">{children}</div>
      </article>

      <aside className="reader-context">
        <div className="toc-panel">
          <p className="rail-label">本文目录</p>
          <nav>
            {document.headings.filter((heading) => heading.depth > 1).map((heading, index) => (
              <a className={`toc-depth-${heading.depth}`} href={`#${heading.slug}`} key={`${heading.slug}-${index}`}>{heading.text}</a>
            ))}
          </nav>
        </div>
        {isOwner ? (
          <div className="notes-panel"><AnnotationPanel spaceSlug={space.slug} documentId={document.id} revision={document.revision} /></div>
        ) : (
          <div className="owner-note"><MessageSquareText size={18} /><p>登录后可选择正文文字，通过浮动菜单批注，并跨设备保存阅读进度。</p><Link href={`/login?returnTo=${encodeURIComponent(`/spaces/${space.slug}/learn/${document.slug}`)}`}>站长登录</Link></div>
        )}
      </aside>
    </main>
  )
}
