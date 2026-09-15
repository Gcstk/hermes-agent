import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import { rowToAnnotation } from '@/lib/annotations'
import { isAdmin } from '@/lib/auth'
import { getSpace } from '@/lib/catalog'
import { getDocument } from '@/lib/content'
import { getDatabase } from '@/lib/db'
import { assertSameOrigin, jsonError } from '@/lib/http'

const targetSchema = z.object({
  blockId: z.string().min(1).max(160),
  revision: z.string().min(8).max(128),
  quote: z.object({ exact: z.string().min(1).max(500), prefix: z.string().max(64), suffix: z.string().max(64) }),
  position: z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }),
}).refine((target) => target.position.end > target.position.start, '批注范围无效')

const createSchema = z.object({
  documentId: z.string().min(1).max(300),
  target: targetSchema,
  body: z.string().trim().min(1).max(10_000),
  color: z.enum(['cyan', 'violet', 'amber']).default('cyan'),
})

export async function GET(request: Request, context: { params: Promise<{ spaceSlug: string }> }) {
  if (!await isAdmin()) return jsonError('需要登录', 401)
  const { spaceSlug } = await context.params
  const space = await getSpace(spaceSlug, { includeUnpublished: true })
  if (!space) return jsonError('学习空间不存在', 404)
  const documentId = new URL(request.url).searchParams.get('document')
  const rows = documentId
    ? getDatabase().prepare('SELECT * FROM annotations WHERE space_id = ? AND document_id = ? ORDER BY created_at DESC').all(space.id, documentId)
    : getDatabase().prepare('SELECT * FROM annotations WHERE space_id = ? ORDER BY updated_at DESC').all(space.id)
  return Response.json((rows as Array<Record<string, string>>).map(rowToAnnotation))
}

export async function POST(request: Request, context: { params: Promise<{ spaceSlug: string }> }) {
  if (!await isAdmin()) return jsonError('需要登录', 401)
  if (!assertSameOrigin(request)) return jsonError('请求来源无效', 403)
  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? '批注内容无效')
  const { spaceSlug } = await context.params
  const space = await getSpace(spaceSlug, { includeUnpublished: true })
  if (!space) return jsonError('学习空间不存在', 404)
  if (!await getDocument(space, parsed.data.documentId, { includeUnpublished: true })) return jsonError('文章不存在', 404)
  const id = randomUUID()
  const now = new Date().toISOString()
  getDatabase().prepare("INSERT INTO annotations(id, space_id, document_id, target_json, body, color, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)")
    .run(id, space.id, parsed.data.documentId, JSON.stringify(parsed.data.target), parsed.data.body, parsed.data.color, now, now)
  const row = getDatabase().prepare('SELECT * FROM annotations WHERE id = ?').get(id) as Record<string, string>
  return Response.json(rowToAnnotation(row), { status: 201 })
}
