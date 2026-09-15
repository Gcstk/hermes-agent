import { AdminNav } from '@/components/admin-nav'
import { AdminSpaceForm } from '@/components/admin-space-form'
import { requireAdminPage } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function NewSpacePage() {
  await requireAdminPage('/admin/spaces/new')
  return <main className="page-shell compact-page admin-page"><AdminNav /><header className="page-heading"><p className="eyebrow">NEW SPACE</p><h1>创建学习模块</h1><p>新模块会以草稿状态写入受控内容目录，并生成一篇可继续编辑的学习地图。</p></header><AdminSpaceForm /></main>
}
