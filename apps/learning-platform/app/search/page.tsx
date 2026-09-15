import { Search } from 'lucide-react'
import Link from 'next/link'

import { listSpaces } from '@/lib/catalog'
import { searchDocuments } from '@/lib/search'

export const dynamic = 'force-dynamic'

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; space?: string; category?: string; tag?: string }> }) {
  const { q = '', space, category, tag } = await searchParams
  const [results, spaces] = await Promise.all([
    q ? searchDocuments(q, { spaceSlug: space, category, tag }) : Promise.resolve([]),
    listSpaces(),
  ])
  const categories = [...new Set(spaces.map((item) => item.category))]
  const tags = [...new Set(spaces.flatMap((item) => item.tags))].sort()
  return (
    <main className="page-shell compact-page search-page">
      <header className="page-heading"><p className="eyebrow"><Search size={15} /> GLOBAL SEARCH</p><h1>跨空间搜索</h1><p>同时检索标题、正文、源码路径、标签和设计术语，结果始终标明所属模块。</p></header>
      <form className="search-workbench" action="/search">
        <Search size={20} />
        <input name="q" defaultValue={q} placeholder="例如：prompt cache、PagedAttention、optimizer" autoFocus />
        <select name="space" defaultValue={space ?? ''} aria-label="限定学习空间">
          <option value="">全部空间</option>
          {spaces.map((item) => <option key={item.id} value={item.slug}>{item.title}</option>)}
        </select>
        <select name="category" defaultValue={category ?? ''} aria-label="限定分类">
          <option value="">全部分类</option>
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select name="tag" defaultValue={tag ?? ''} aria-label="限定标签">
          <option value="">全部标签</option>
          {tags.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <button type="submit">搜索</button>
      </form>
      {!q ? <div className="empty-state">输入一个概念，开始横跨所有学习空间查找关联知识。</div> : results.length === 0 ? <div className="empty-state">没有找到“{q}”。可以换一个术语或取消空间筛选。</div> : (
        <section className="search-results" aria-label="搜索结果">
          <p>{results.length} 个结果</p>
          {results.map((result) => (
            <Link href={`/spaces/${result.spaceSlug}/learn/${result.documentSlug}`} key={`${result.spaceId}-${result.documentId}`}>
              <div><span>{result.spaceTitle}</span><b>{result.category}</b></div>
              <h2>{result.title}</h2>
              <p>{result.excerpt.replace(/<\/?mark>/g, '') || result.summary}</p>
            </Link>
          ))}
        </section>
      )}
    </main>
  )
}
