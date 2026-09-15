import { ArrowUpRight, BookOpenText, Clock3 } from 'lucide-react'
import Link from 'next/link'

import type { SpaceSummary } from '@/lib/types'

export function SpaceCard({ space }: { space: SpaceSummary }) {
  return (
    <article className={`space-card accent-${space.accent ?? 'blue'}`}>
      <div className="space-card-topline">
        <span className="category-label">{space.category}</span>
        <span className="document-count"><BookOpenText size={15} />{space.documentCount} 篇</span>
      </div>
      {space.cover && <img className="space-card-cover" src={space.cover} alt="" />}
      <div>
        <h2>{space.title}</h2>
        <p>{space.description}</p>
      </div>
      <div className="tag-list" aria-label="标签">
        {space.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      {space.completedCount !== undefined && <div className="card-progress" aria-label={`已完成 ${space.completedCount} / ${space.documentCount}`}>
        <div><span>学习进度</span><b>{space.completedCount} / {space.documentCount}</b></div>
        <progress max={Math.max(1, space.documentCount)} value={space.completedCount} />
      </div>}
      <div className="space-card-footer">
        <span><Clock3 size={15} />更新于 {new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(space.updatedAt))}</span>
        <Link href={`/spaces/${space.slug}`} aria-label={`进入 ${space.title}`}>
          进入模块 <ArrowUpRight size={17} />
        </Link>
      </div>
    </article>
  )
}
