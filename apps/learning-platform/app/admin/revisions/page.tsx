import { History } from 'lucide-react'

import { AdminNav } from '@/components/admin-nav'
import { requireAdminPage } from '@/lib/auth'
import { listSpaces } from '@/lib/catalog'
import { listDocuments } from '@/lib/content'
import { fileHistory } from '@/lib/git-publisher'

export const dynamic = 'force-dynamic'

export default async function RevisionsPage() {
  await requireAdminPage('/admin/revisions')
  const spaces = await listSpaces({ includeUnpublished: true })
  const revisions = []
  for (const space of spaces) {
    const documents = await listDocuments(space, { includeUnpublished: true })
    for (const document of documents.slice(0, 20)) {
      const history = await fileHistory(`${space.contentRoot}/${document.path}`, 5)
      for (const entry of history) revisions.push({ ...entry, space: space.title, document: document.title })
    }
  }
  revisions.sort((left, right) => right.date.localeCompare(left.date))
  return <main className="page-shell compact-page admin-page"><AdminNav /><header className="page-heading"><p className="eyebrow"><History size={15} /> GIT HISTORY</p><h1>版本记录</h1><p>每次发布和恢复都以新增 Git 提交保存，不重写历史。</p></header><div className="revision-list">{revisions.length === 0 ? <div className="empty-state">当前学习内容还没有可显示的提交记录。</div> : revisions.slice(0, 80).map((entry) => <article key={`${entry.revision}-${entry.document}`}><code>{entry.revision.slice(0, 8)}</code><div><strong>{entry.subject}</strong><p>{entry.space} · {entry.document}</p></div><time>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.date))}</time></article>)}</div></main>
}
