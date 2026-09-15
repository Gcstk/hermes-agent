'use client'

import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function AdminSpaceForm() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setMessage('')
    const response = await fetch('/api/admin/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: form.get('slug'),
        title: form.get('title'),
        description: form.get('description'),
        category: form.get('category'),
        tags: String(form.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
        accent: form.get('accent'),
      }),
    })
    const payload = await response.json()
    setPending(false)
    if (!response.ok) return setMessage(payload.error ?? '创建失败')
    router.push(`/admin/spaces/${payload.space.slug}`)
    router.refresh()
  }

  return (
    <form className="admin-form" onSubmit={submit}>
      <div className="field-grid"><label>模块名称<input name="title" required placeholder="例如：Distributed Systems" /></label><label>URL slug<input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="distributed-systems" /></label></div>
      <label>简介<textarea name="description" required minLength={10} placeholder="这个学习空间用来理解什么？" /></label>
      <div className="field-grid"><label>分类<input name="category" required placeholder="Systems Courses" /></label><label>标签<input name="tags" placeholder="systems, consensus, labs" /></label></div>
      <label>强调色<select name="accent" defaultValue="blue"><option value="blue">蓝色</option><option value="cyan">青色</option><option value="violet">紫色</option><option value="amber">琥珀色</option></select></label>
      {message && <p className="form-error" role="alert">{message}</p>}
      <button className="primary-button" type="submit" disabled={pending}><Plus size={17} />{pending ? '正在创建并提交…' : '创建草稿模块'}</button>
    </form>
  )
}
