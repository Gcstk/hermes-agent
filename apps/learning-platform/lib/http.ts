export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status })
}

export function assertSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    const expectedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
      || request.headers.get('host')
      || new URL(request.url).host
    return new URL(origin).host === expectedHost
  } catch {
    return false
  }
}
