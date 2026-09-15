import { ArrowRight, Compass, Layers3, Play, Search, Sparkles } from 'lucide-react'
import Link from 'next/link'

import { SpaceCard } from '@/components/space-card'
import { isAdmin } from '@/lib/auth'
import { listSpaces } from '@/lib/catalog'
import { getDocument, listDocuments } from '@/lib/content'
import { completedCountBySpace, listProgress } from '@/lib/progress'
import type { SpaceSummary } from '@/lib/types'

export const dynamic = 'force-dynamic'

const homeViews = {
  featured: { eyebrow: 'FEATURED SPACES', title: '从一个学习空间开始' },
  recent: { eyebrow: 'RECENTLY UPDATED', title: '最近更新的学习空间' },
  paths: { eyebrow: 'LEARNING PATHS', title: '按学习路线继续深入' },
} as const

export default async function HomePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const requestedView = (await searchParams).view
  const view = requestedView && requestedView in homeViews ? requestedView as keyof typeof homeViews : 'featured'
  const [spaces, owner] = await Promise.all([listSpaces(), isAdmin()])
  const completed = owner ? completedCountBySpace() : new Map<string, number>()
  const summaries: SpaceSummary[] = await Promise.all(spaces.map(async (space) => ({
    ...space,
    documentCount: (await listDocuments(space)).length,
    completedCount: owner ? completed.get(space.id) ?? 0 : undefined,
  })))
  const displayed = view === 'featured'
    ? summaries.filter((space) => space.featured)
    : view === 'recent'
      ? [...summaries].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      : summaries
  const categories = [...new Set(summaries.map((space) => space.category))]
  const latestProgress = owner ? listProgress()[0] : undefined
  const latestSpace = latestProgress ? summaries.find((space) => space.id === latestProgress.spaceId) : undefined
  const latestDocument = latestSpace && latestProgress
    ? await getDocument(latestSpace, latestProgress.documentId)
    : null

  return (
    <main className="page-shell">
      <section className="home-intro">
        <div className="intro-copy">
          <p className="eyebrow"><Sparkles size={15} /> PERSONAL KNOWLEDGE ATLAS</p>
          <h1>把复杂系统，学成一张能持续生长的图。</h1>
          <p>从 Agent Harness 到推理引擎与大模型课程。每个主题拥有独立的学习地图、源码笔记、实验与复盘。</p>
        </div>
        <form className="global-search" action="/search">
          <Search size={20} aria-hidden="true" />
          <label className="sr-only" htmlFor="home-search">搜索全部学习空间</label>
          <input id="home-search" name="q" placeholder="搜索概念、源码路径、设计模式…" />
          <kbd>⌘ K</kbd>
        </form>
      </section>

      {latestSpace && latestDocument && <Link className="continue-banner" href={`/spaces/${latestSpace.slug}/learn/${latestDocument.slug}`}>
        <span><Play size={18} /></span>
        <div><p>继续学习 · {latestSpace.title}</p><strong>{latestDocument.title}</strong></div>
        <b>{latestProgress?.completed ? '再次阅读' : '回到上次位置'} <ArrowRight size={17} /></b>
      </Link>}

      <section className="atlas-strip" aria-label="知识库概览">
        <div><Layers3 size={19} /><strong>{summaries.length}</strong><span>学习空间</span></div>
        <div><Compass size={19} /><strong>{summaries.reduce((total, space) => total + space.documentCount, 0)}</strong><span>篇学习笔记</span></div>
        <div className="category-list"><span>覆盖方向</span>{categories.map((category) => <b key={category}>{category}</b>)}</div>
      </section>

      <section className="section-heading">
        <div>
          <p className="eyebrow">{homeViews[view].eyebrow}</p>
          <h2>{homeViews[view].title}</h2>
        </div>
        <Link href="/spaces">查看全部 <ArrowRight size={17} /></Link>
      </section>
      <nav className="home-view-tabs" aria-label="首页模块视图">
        <Link className={view === 'featured' ? 'active' : ''} href="/?view=featured">精选模块</Link>
        <Link className={view === 'recent' ? 'active' : ''} href="/?view=recent">最近更新</Link>
        <Link className={view === 'paths' ? 'active' : ''} href="/?view=paths">学习路线</Link>
      </nav>
      <section className="space-grid">
        {displayed.map((space) => <SpaceCard key={space.id} space={space} />)}
      </section>
    </main>
  )
}
