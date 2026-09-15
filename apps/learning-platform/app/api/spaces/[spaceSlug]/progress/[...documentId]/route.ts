import { isAdmin } from '@/lib/auth'
import { getSpace } from '@/lib/catalog'
import { getDocument } from '@/lib/content'
import { getDatabase } from '@/lib/db'
import { assertSameOrigin, jsonError } from '@/lib/http'
import type { ReadingProgress } from '@/lib/types'

function readProgress(spaceId: string, documentId: string): ReadingProgress {
  const row = getDatabase().prepare('SELECT space_id, document_id, completed, scroll_position, updated_at FROM reading_progress WHERE space_id = ? AND document_id = ?').get(spaceId, documentId) as { space_id: string; document_id: string; completed: number; scroll_position: number; updated_at: string } | undefined
  return row ? { spaceId: row.space_id, documentId: row.document_id, completed: Boolean(row.completed), scrollPosition: row.scroll_position, updatedAt: row.updated_at } : { spaceId, documentId, completed: false, scrollPosition: 0, updatedAt: new Date(0).toISOString() }
}

export async function GET(_request: Request, context: { params: Promise<{ spaceSlug: string; documentId: string[] }> }) {
  if (!await isAdmin()) return jsonError('需要登录', 401)
  const { spaceSlug, documentId } = await context.params
  const space = await getSpace(spaceSlug, { includeUnpublished: true })
  if (!space) return jsonError('学习空间不存在', 404)
  const id = documentId.join('/')
  if (!await getDocument(space, id, { includeUnpublished: true })) return jsonError('文章不存在', 404)
  return Response.json(readProgress(space.id, id))
}

export async function PUT(request: Request, context: { params: Promise<{ spaceSlug: string; documentId: string[] }> }) {
  if (!await isAdmin()) return jsonError('需要登录', 401)
  if (!assertSameOrigin(request)) return jsonError('请求来源无效', 403)
  const payload = await request.json().catch(() => null) as { completed?: unknown; scrollPosition?: unknown } | null
  if (!payload) return jsonError('请求内容无效')
  const { spaceSlug, documentId } = await context.params
  const space = await getSpace(spaceSlug, { includeUnpublished: true })
  if (!space) return jsonError('学习空间不存在', 404)
  const id = documentId.join('/')
  if (!await getDocument(space, id, { includeUnpublished: true })) return jsonError('文章不存在', 404)
  const current = readProgress(space.id, id)
  const completed = typeof payload.completed === 'boolean' ? payload.completed : current.completed
  const scrollPosition = typeof payload.scrollPosition === 'number' ? Math.max(0, Math.min(1, payload.scrollPosition)) : current.scrollPosition
  const updatedAt = new Date().toISOString()
  getDatabase().prepare('INSERT INTO reading_progress(space_id, document_id, completed, scroll_position, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(space_id, document_id) DO UPDATE SET completed = excluded.completed, scroll_position = excluded.scroll_position, updated_at = excluded.updated_at').run(space.id, id, completed ? 1 : 0, scrollPosition, updatedAt)
  return Response.json({ spaceId: space.id, documentId: id, completed, scrollPosition, updatedAt })
}
