import { createAdminSession, clearLoginAttempts, loginRateLimit, recordFailedLogin, verifyAdminPassword } from '@/lib/auth'
import { assertSameOrigin, jsonError } from '@/lib/http'

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError('请求来源无效', 403)
  const clientKey = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const limit = loginRateLimit(clientKey)
  if (!limit.allowed) {
    return Response.json({ error: '尝试次数过多，请稍后再试' }, {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfterSeconds ?? 900) },
    })
  }
  const payload = await request.json().catch(() => null) as { password?: unknown } | null
  if (typeof payload?.password !== 'string' || !verifyAdminPassword(payload.password)) {
    recordFailedLogin(clientKey)
    return jsonError('密码不正确', 401)
  }
  clearLoginAttempts(clientKey)
  await createAdminSession()
  return Response.json({ ok: true })
}
