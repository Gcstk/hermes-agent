'use client'

import { Save } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import type { LearningSpace } from '@/lib/types'

export function AdminSpaceMetadataForm({ space }: { space: LearningSpace }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setMessage('')
    const response = await fetch(`/api/admin/spaces/${space.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.get('title'),
        description: form.get('description'),
        category: form.get('category'),
        tags: String(form.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
        cover: String(form.get('cover') || ''),
        accent: form.get('accent'),
        order: Number(form.get('order')),
        featured: form.get('featured') === 'on',
      }),
    })
    const payload = await response.json()
    setPending(false)
    if (!response.ok) return setMessage(payload.error ?? '保存失败')
    setMessage(`已写入 catalog 并提交 ${String(payload.revision).slice(0, 8)}`)
    router.refresh()
  }

  return <form className="admin-form metadata-form" onSubmit={submit}>
    <div className="field-grid"><label>模块名称<input name="title" required defaultValue={space.title} /></label><label>分类<input name="category" required defaultValue={space.category} /></label></div>
    <label>简介<textarea name="description" required minLength={10} defaultValue={space.description} /></label>
    <div className="field-grid"><label>标签<input name="tags" defaultValue={space.tags.join(', ')} /></label><label>封面路径或 URL<input name="cover" defaultValue={space.cover ?? ''} placeholder="可选" /></label></div>
    <div className="field-grid"><label>排序权重<input name="order" type="number" min="0" max="100000" defaultValue={space.order} /></label><label>强调色<select name="accent" defaultValue={space.accent ?? 'blue'}><option value="blue">蓝色</option><option value="cyan">青色</option><option value="violet">紫色</option><option value="amber">琥珀色</option></select></label></div>
    <label className="checkbox-field"><input name="featured" type="checkbox" defaultChecked={space.featured} />在首页精选模块中展示</label>
    {message && <p className={message.startsWith('已') ? 'form-success' : 'form-error'} role="status">{message}</p>}
    <button className="primary-button" type="submit" disabled={pending}><Save size={16} />{pending ? '正在提交…' : '保存模块设置'}</button>
  </form>
}
