import { z } from 'zod'

import { rowToAnnotation } from '@/lib/annotations'
import { isAdmin } from '@/lib/auth'
import { getSpace } from '@/lib/catalog'
import { getDatabase } from '@/lib/db'
import { assertSameOrigin, jsonError } from '@/lib/http'

const updateSchema = z.object({
  body: z.string().trim().min(1).max(10_000).optional(),
  status: z.enum(['active', 'resolved', 'orphaned']).optional(),
  color: z.enum(['cyan', 'violet', 'amber']).optional(),
}).refine((target) => Object.keys(target).length > 0, '批注更新为空')

export async function PATCH(request: Request, context: { params: Promise<{ spaceSlug: string; annotationId: string }> }) {
  if (!await isAdmin()) return jsonError('需要登录', 401)
  if (!assertSameOrigin(request)) return jsonError('请求来源无效', 403)
  const parsed = updateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? '批注内容无效')
  const { spaceSlug, annotationId } = await context.params
  const space = await getSpace(spaceSlug, { includeUnpublished: true })
  if (!space) return jsonError('学习空间不存在', 404)
  const current = getDatabase().prepare('SELECT * FROM annotations WHERE id = ? AND space_id = ?').get(annotationId, space.id) as Record<string, string> | undefined
  if (!current) return jsonError('批注不存在', 404)
  getDatabase().prepare('UPDATE annotations SET body = ?, color = ?, status = ?, updated_at = ? WHERE id = ? AND space_id = ?')
    .run(parsed.data.body ?? current.body, parsed.data.color ?? current.color, parsed.data.status ?? current.status, new Date().toISOString(), annotationId, space.id)
  const row = getDatabase().prepare('SELECT * FROM annotations WHERE id = ?').get(annotationId) as Record<string, string>
  return Response.json(rowToAnnotation(row))
}

export async function DELETE(request: Request, context: { params: Promise<{ spaceSlug: string; annotationId: string }> }) {
  if (!await isAdmin()) return jsonError('需要登录', 401)
  if (!assertSameOrigin(request)) return jsonError('请求来源无效', 403)
  const { spaceSlug, annotationId } = await context.params
  const space = await getSpace(spaceSlug, { includeUnpublished: true })
  if (!space) return jsonError('学习空间不存在', 404)
  const result = getDatabase().prepare('DELETE FROM annotations WHERE id = ? AND space_id = ?').run(annotationId, space.id)
  return result.changes ? new Response(null, { status: 204 }) : jsonError('批注不存在', 404)
}
