import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  delete process.env.LEARNING_DATA_DIR
  vi.resetModules()
})

describe('space-scoped owner state', () => {
  it('stores the same document id independently in two spaces', async () => {
    process.env.LEARNING_DATA_DIR = await mkdtemp(path.join(tmpdir(), 'learning-platform-db-'))
    vi.resetModules()
    const { getDatabase } = await import('@/lib/db')
    const database = getDatabase()
    const write = database.prepare('INSERT INTO reading_progress(space_id, document_id, completed, scroll_position, updated_at) VALUES (?, ?, ?, ?, ?)')
    write.run('space-a', 'index', 1, 0.8, '2026-09-13T00:00:00Z')
    write.run('space-b', 'index', 0, 0.2, '2026-09-13T00:00:00Z')
    const rows = database.prepare('SELECT space_id, completed, scroll_position FROM reading_progress WHERE document_id = ? ORDER BY space_id').all('index') as Array<{ space_id: string; completed: number; scroll_position: number }>
    expect(rows).toEqual([
      { space_id: 'space-a', completed: 1, scroll_position: 0.8 },
      { space_id: 'space-b', completed: 0, scroll_position: 0.2 },
    ])
  })
})
