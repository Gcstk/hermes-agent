'use client'

import { Archive, Eye, EyeOff } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import type { SpaceStatus } from '@/lib/types'

export function SpaceStatusControl({ spaceId, status }: { spaceId: string; status: SpaceStatus }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  async function update(nextStatus: SpaceStatus) {
    setPending(true)
    const response = await fetch(`/api/admin/spaces/${spaceId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) })
    setPending(false)
    if (!response.ok) window.alert((await response.json()).error ?? '更新失败')
    else router.refresh()
  }
  return <div className="status-actions">
    {status !== 'published' && <button type="button" disabled={pending} onClick={() => void update('published')}><Eye size={15} />发布模块</button>}
    {status === 'published' && <button type="button" disabled={pending} onClick={() => void update('draft')}><EyeOff size={15} />转为草稿</button>}
    {status !== 'archived' && <button type="button" disabled={pending} onClick={() => void update('archived')}><Archive size={15} />归档</button>}
  </div>
}
