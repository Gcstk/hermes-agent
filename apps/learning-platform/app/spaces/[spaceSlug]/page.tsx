import { ArrowRight, BookOpenCheck, FlaskConical, Route, Search } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { isAdmin } from '@/lib/auth'
import { getSpace } from '@/lib/catalog'
import { listDocuments } from '@/lib/content'
import { listProgress } from '@/lib/progress'

export const dynamic = 'force-dynamic'

export default async function SpacePage({ params }: { params: Promise<{ spaceSlug: string }> }) {
  const { spaceSlug } = await params
  const space = await getSpace(spaceSlug)
  if (!space) notFound()
  const [documents, owner] = await Promise.all([listDocuments(space), isAdmin()])
  const progress = owner ? listProgress(space.id) : []
  const progressByDocument = new Map(progress.map((item) => [item.documentId, item]))
  const first = documents.find((document) => document.path === space.entryDocument) ?? documents[0]
  const continuation = documents.find((document) => document.id === progress[0]?.documentId) ?? first
  const completedCount = documents.filter((document) => progressByDocument.get(document.id)?.completed).length

  return (
    <main className="page-shell compact-page">
      <header className={`space-hero accent-${space.accent ?? 'blue'}`}>
        <div><p className="eyebrow">{space.category}</p><h1>{space.title}</h1><p>{space.description}</p><div className="tag-list">{space.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div>
        {continuation && <Link className="hero-action" href={`/spaces/${space.slug}/learn/${continuation.slug}`}>{progress.length ? '继续学习' : '开始学习'} <ArrowRight size={18} /></Link>}
      </header>
      <div className="space-tools">
        <form className="module-search" action="/search"><Search size={17} /><input type="hidden" name="space" value={space.slug} /><input name="q" placeholder={`在 ${space.title} 中搜索`} /><button type="submit">搜索</button></form>
        {owner && <span>{completedCount} / {documents.length} 篇已完成</span>}
      </div>
      <section className="learning-path-grid">
        <article><Route size={21} /><span>快速入门</span><strong>先建立端到端心智模型</strong><p>从学习地图和核心术语开始，知道系统边界与主要数据流。</p></article>
        <article><BookOpenCheck size={21} /><span>深入材料</span><strong>沿源码与设计判断深入</strong><p>用时序图、类图和失败语义验证每个抽象为何存在。</p></article>
        <article><FlaskConical size={21} /><span>动手实验</span><strong>把理解变成可复现实验</strong><p>记录假设、执行结果与反例，形成自己的工程判断。</p></article>
      </section>
      <section className="document-section">
        <div className="section-heading"><div><p className="eyebrow">CONTENTS</p><h2>模块目录</h2></div><span>{documents.length} 篇</span></div>
        {documents.length === 0 ? <div className="empty-state">这个模块还没有发布文章。可以在后台创建第一篇学习笔记。</div> : (
          <div className="document-list">{documents.map((document, index) => (
            <Link href={`/spaces/${space.slug}/learn/${document.slug}`} key={document.id}>
              <span className="document-index">{String(index + 1).padStart(2, '0')}</span>
              <div><strong>{document.title}{progressByDocument.get(document.id)?.completed && <small className="completion-badge">已完成</small>}</strong><p>{document.summary}</p></div>
              <div className="document-trailing">{document.estimatedMinutes && <span>{document.estimatedMinutes} 分钟</span>}<ArrowRight size={17} /></div>
            </Link>
          ))}</div>
        )}
      </section>
    </main>
  )
}
