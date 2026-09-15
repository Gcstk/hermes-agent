import { getSpace, listSpaces } from '@/lib/catalog'
import { getDocument, listDocuments } from '@/lib/content'
import { getDatabase } from '@/lib/db'
import type { SearchResult } from '@/lib/types'

function searchableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*/g, ' '))
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`\[\](){}/|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function rebuildSearchIndex(): Promise<void> {
  const database = getDatabase()
  const spaces = await listSpaces()
  const insert = database.prepare(`
    INSERT INTO search_documents(
      space_id, space_slug, space_title, category, document_id, document_slug,
      title, summary, body, tags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec('DELETE FROM search_documents')
    for (const space of spaces) {
      const documents = await listDocuments(space)
      for (const metadata of documents) {
        const document = await getDocument(space, metadata.slug)
        if (!document) continue
        insert.run(
          space.id,
          space.slug,
          space.title,
          space.category,
          document.id,
          document.slug,
          document.title,
          document.summary,
          searchableText(`${metadata.path}\n${document.body}`),
          [...new Set([...space.tags, ...document.tags])].join(' '),
        )
      }
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export interface SearchFilters {
  spaceSlug?: string
  category?: string
  tag?: string
}

export async function searchDocuments(query: string, filters: SearchFilters = {}): Promise<SearchResult[]> {
  const normalized = query.trim().slice(0, 200)
  if (!normalized) return []
  await rebuildSearchIndex()
  const database = getDatabase()
  const params: Array<string | number> = []
  let predicate = 'search_documents MATCH ?'
  params.push(`"${normalized.replaceAll('"', '""')}"`)
  let spaceId: string | undefined
  if (filters.spaceSlug) {
    const space = await getSpace(filters.spaceSlug)
    if (!space) return []
    spaceId = space.id
    predicate += ' AND space_id = ?'
    params.push(space.id)
  }
  if (filters.category) {
    predicate += ' AND category = ?'
    params.push(filters.category)
  }
  if (filters.tag) {
    predicate += ' AND lower(tags) LIKE ?'
    params.push(`%${filters.tag.toLowerCase()}%`)
  }
  params.push(40)
  let rows: Array<Record<string, string>> = []
  if ([...normalized].length >= 3) try {
    rows = database.prepare(`
      SELECT space_id, space_slug, space_title, category, document_id, document_slug,
             title, summary, tags, snippet(search_documents, 8, '<mark>', '</mark>', '…', 24) AS excerpt
      FROM search_documents
      WHERE ${predicate}
      ORDER BY rank
      LIMIT ?
    `).all(...params) as Array<Record<string, string>>
  } catch {
    rows = []
  }
  if (rows.length === 0) {
    const like = `%${normalized.toLowerCase()}%`
    const fallbackParams: Array<string | number> = [like, like, like]
    let fallbackPredicate = '(lower(title) LIKE ? OR lower(summary) LIKE ? OR lower(body) LIKE ?)'
    if (spaceId) {
      fallbackPredicate += ' AND space_id = ?'
      fallbackParams.push(spaceId)
    }
    if (filters.category) {
      fallbackPredicate += ' AND category = ?'
      fallbackParams.push(filters.category)
    }
    if (filters.tag) {
      fallbackPredicate += ' AND lower(tags) LIKE ?'
      fallbackParams.push(`%${filters.tag.toLowerCase()}%`)
    }
    fallbackParams.push(40)
    rows = database.prepare(`
      SELECT space_id, space_slug, space_title, category, document_id, document_slug,
             title, summary, tags, substr(body, 1, 220) AS excerpt
      FROM search_documents WHERE ${fallbackPredicate} LIMIT ?
    `).all(...fallbackParams) as Array<Record<string, string>>
  }
  return rows.map((row) => ({
    spaceId: row.space_id,
    spaceSlug: row.space_slug,
    spaceTitle: row.space_title,
    category: row.category,
    documentId: row.document_id,
    documentSlug: row.document_slug,
    title: row.title,
    summary: row.summary,
    excerpt: row.excerpt,
    tags: row.tags ? row.tags.split(' ') : [],
  }))
}
