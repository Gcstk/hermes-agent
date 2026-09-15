import { Layers3 } from 'lucide-react'
import Link from 'next/link'

import { SpaceCard } from '@/components/space-card'
import { isAdmin } from '@/lib/auth'
import { listSpaces } from '@/lib/catalog'
import { listDocuments } from '@/lib/content'
import { completedCountBySpace } from '@/lib/progress'

export const dynamic = 'force-dynamic'

export default async function SpacesPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { category } = await searchParams
  const [spaces, owner] = await Promise.all([listSpaces(), isAdmin()])
  const completed = owner ? completedCountBySpace() : new Map<string, number>()
  const categories = [...new Set(spaces.map((space) => space.category))]
  const visible = category ? spaces.filter((space) => space.category === category) : spaces
  const summaries = await Promise.all(visible.map(async (space) => ({
    ...space,
    documentCount: (await listDocuments(space)).length,
    completedCount: owner ? completed.get(space.id) ?? 0 : undefined,
  })))

  return (
    <main className="page-shell compact-page">
      <header className="page-heading"><p className="eyebrow"><Layers3 size={15} /> LEARNING SPACES</p><h1>全部学习空间</h1><p>按主题进入独立的知识地图。模块之间共享搜索和阅读工具，但内容结构互不限制。</p></header>
      <nav className="filter-row" aria-label="分类筛选">
        <Link className={!category ? 'active' : ''} href="/spaces">全部</Link>
        {categories.map((item) => <Link className={category === item ? 'active' : ''} href={`/spaces?category=${encodeURIComponent(item)}`} key={item}>{item}</Link>)}
      </nav>
      <section className="space-grid">
        {summaries.map((space) => <SpaceCard key={space.id} space={space} />)}
      </section>
    </main>
  )
}
