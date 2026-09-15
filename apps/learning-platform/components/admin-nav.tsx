import { BookCopy, History, Plus } from 'lucide-react'
import Link from 'next/link'

export function AdminNav() {
  return <nav className="admin-nav" aria-label="后台导航"><Link href="/admin/spaces"><BookCopy size={16} />内容空间</Link><Link href="/admin/spaces/new"><Plus size={16} />新建模块</Link><Link href="/admin/revisions"><History size={16} />版本记录</Link></nav>
}
