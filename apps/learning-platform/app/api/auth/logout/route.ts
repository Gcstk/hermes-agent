import { destroyAdminSession } from '@/lib/auth'
import { assertSameOrigin, jsonError } from '@/lib/http'

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError('请求来源无效', 403)
  await destroyAdminSession()
  return Response.json({ ok: true })
}
