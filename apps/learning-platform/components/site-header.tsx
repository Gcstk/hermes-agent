import { BookOpen, Search } from 'lucide-react'
import Link from 'next/link'

import { LogoutButton } from '@/components/logout-button'
import { ThemeToggle } from '@/components/theme-toggle'
import { isAdmin } from '@/lib/auth'

export async function SiteHeader() {
  const owner = await isAdmin()
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href="/">
          <span className="brand-mark"><BookOpen size={19} /></span>
          <span>学习图谱</span>
        </Link>
        <nav className="main-nav" aria-label="主导航">
          <Link href="/spaces">学习空间</Link>
          <Link href="/search"><Search size={16} />搜索</Link>
        </nav>
        <div className="header-actions">
          <ThemeToggle />
          {owner ? <><Link className="text-button" href="/notes">批注</Link><Link className="text-button" href="/admin/spaces">后台</Link><LogoutButton /></> : <Link className="text-button" href="/login">站长登录</Link>}
        </div>
      </div>
    </header>
  )
}
