import type { Annotation } from '@/lib/types'

export function rowToAnnotation(row: Record<string, string>): Annotation {
  return {
    id: row.id,
    spaceId: row.space_id,
    documentId: row.document_id,
    target: JSON.parse(row.target_json),
    body: row.body,
    color: row.color as Annotation['color'],
    status: row.status as Annotation['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
