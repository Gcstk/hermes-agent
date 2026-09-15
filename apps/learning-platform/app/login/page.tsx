import { redirect } from 'next/navigation'

import { LoginForm } from '@/components/login-form'
import { isAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  if (await isAdmin()) redirect('/admin/spaces')
  return <main className="auth-shell"><LoginForm /></main>
}
