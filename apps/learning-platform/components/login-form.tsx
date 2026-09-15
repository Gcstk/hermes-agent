'use client'

import { LockKeyhole } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setMessage('')
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    const payload = await response.json()
    setPending(false)
    if (!response.ok) {
      setMessage(payload.error ?? '登录失败')
      return
    }
    const returnTo = searchParams.get('returnTo')
    router.push(returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/admin/spaces')
    router.refresh()
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <span className="login-icon"><LockKeyhole size={22} /></span>
      <div><p className="eyebrow">OWNER ACCESS</p><h1>站长登录</h1><p>登录后可以编辑内容、保存学习进度，并在阅读页添加私有批注。</p></div>
      <label htmlFor="password">管理密码</label>
      <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
      {message && <p className="form-error" role="alert">{message}</p>}
      <button className="primary-button" type="submit" disabled={pending}>{pending ? '正在验证…' : '登录'}</button>
      {process.env.NODE_ENV !== 'production' && <p className="dev-hint">本地默认密码：<code>learn-local</code>。可在环境变量中覆盖。</p>}
    </form>
  )
}
