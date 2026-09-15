import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { getDatabase } from '@/lib/db'

const SESSION_COOKIE = 'learning_admin_session'
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 14

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function configuredPassword(): string | null {
  if (process.env.LEARNING_ADMIN_PASSWORD) return process.env.LEARNING_ADMIN_PASSWORD
  return process.env.NODE_ENV === 'production' ? null : 'learn-local'
}

export function verifyAdminPassword(candidate: string): boolean {
  const expected = configuredPassword()
  if (!expected) return false
  const expectedBuffer = Buffer.from(expected)
  const candidateBuffer = Buffer.from(candidate)
  if (expectedBuffer.length !== candidateBuffer.length) return false
  return timingSafeEqual(expectedBuffer, candidateBuffer)
}

export function loginRateLimit(clientKey: string): { allowed: boolean; retryAfterSeconds?: number } {
  const database = getDatabase()
  const now = Date.now()
  const row = database.prepare(
    'SELECT attempts, window_started_at, blocked_until FROM login_attempts WHERE client_key = ?',
  ).get(clientKey) as { attempts: number; window_started_at: string; blocked_until: string | null } | undefined
  if (row?.blocked_until && Date.parse(row.blocked_until) > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((Date.parse(row.blocked_until) - now) / 1000) }
  }
  if (!row || now - Date.parse(row.window_started_at) > 15 * 60 * 1000) {
    database.prepare(
      'INSERT OR REPLACE INTO login_attempts(client_key, attempts, window_started_at, blocked_until) VALUES (?, 0, ?, NULL)',
    ).run(clientKey, new Date(now).toISOString())
  }
  return { allowed: true }
}

export function recordFailedLogin(clientKey: string): void {
  const database = getDatabase()
  const current = database.prepare('SELECT attempts FROM login_attempts WHERE client_key = ?').get(clientKey) as { attempts: number } | undefined
  const attempts = (current?.attempts ?? 0) + 1
  const blockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null
  database.prepare(
    'INSERT OR REPLACE INTO login_attempts(client_key, attempts, window_started_at, blocked_until) VALUES (?, ?, COALESCE((SELECT window_started_at FROM login_attempts WHERE client_key = ?), ?), ?)',
  ).run(clientKey, attempts, clientKey, new Date().toISOString(), blockedUntil)
}

export function clearLoginAttempts(clientKey: string): void {
  getDatabase().prepare('DELETE FROM login_attempts WHERE client_key = ?').run(clientKey)
}

export async function createAdminSession(): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_SECONDS * 1000)
  const database = getDatabase()
  database.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now.toISOString())
  database.prepare('INSERT INTO admin_sessions(token_hash, created_at, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), now.toISOString(), expiresAt.toISOString())
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DURATION_SECONDS,
  })
}

export async function destroyAdminSession(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) getDatabase().prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hashToken(token))
  cookieStore.delete(SESSION_COOKIE)
}

export async function isAdmin(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return false
  const row = getDatabase().prepare(
    'SELECT expires_at FROM admin_sessions WHERE token_hash = ?',
  ).get(hashToken(token)) as { expires_at: string } | undefined
  return Boolean(row && Date.parse(row.expires_at) > Date.now())
}

export async function requireAdminPage(returnTo: string): Promise<void> {
  if (!await isAdmin()) redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`)
}
