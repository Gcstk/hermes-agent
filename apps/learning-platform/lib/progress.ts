import { getDatabase } from '@/lib/db'
import type { ReadingProgress } from '@/lib/types'

interface ProgressRow {
  space_id: string
  document_id: string
  completed: number
  scroll_position: number
  updated_at: string
}

function fromRow(row: ProgressRow): ReadingProgress {
  return {
    spaceId: row.space_id,
    documentId: row.document_id,
    completed: Boolean(row.completed),
    scrollPosition: row.scroll_position,
    updatedAt: row.updated_at,
  }
}

export function listProgress(spaceId?: string): ReadingProgress[] {
  const rows = spaceId
    ? getDatabase().prepare('SELECT * FROM reading_progress WHERE space_id = ? ORDER BY updated_at DESC').all(spaceId)
    : getDatabase().prepare('SELECT * FROM reading_progress ORDER BY updated_at DESC').all()
  return (rows as unknown as ProgressRow[]).map(fromRow)
}

export function completedCountBySpace(): Map<string, number> {
  const rows = getDatabase().prepare(`
    SELECT space_id, COUNT(*) AS completed_count
    FROM reading_progress WHERE completed = 1 GROUP BY space_id
  `).all() as unknown as Array<{ space_id: string; completed_count: number }>
  return new Map(rows.map((row) => [row.space_id, row.completed_count]))
}
