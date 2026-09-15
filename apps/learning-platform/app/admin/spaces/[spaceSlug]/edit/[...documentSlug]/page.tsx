import { notFound } from 'next/navigation'

import { AdminDocumentEditor } from '@/components/admin-document-editor'
import { requireAdminPage } from '@/lib/auth'
import { getSpace } from '@/lib/catalog'
import { getDocument } from '@/lib/content'
import { getDatabase } from '@/lib/db'
import { fileHistory } from '@/lib/git-publisher'

export const dynamic = 'force-dynamic'

export default async function EditDocumentPage({ params }: { params: Promise<{ spaceSlug: string; documentSlug: string[] }> }) {
  const { spaceSlug, documentSlug } = await params
  const documentId = documentSlug.join('/')
  await requireAdminPage(`/admin/spaces/${spaceSlug}/edit/${documentId}`)
  const space = await getSpace(spaceSlug, { includeUnpublished: true })
  if (!space) notFound()
  const document = await getDocument(space, documentId, { includeUnpublished: true })
  if (!document) notFound()
  const sourcePath = `${space.contentRoot}/${document.path}`
  const revisions = await fileHistory(sourcePath)
  const draft = getDatabase().prepare('SELECT source, base_revision FROM document_drafts WHERE space_id = ? AND document_id = ?').get(space.id, document.id) as { source: string; base_revision: string } | undefined
  return <main className="admin-editor-page"><AdminDocumentEditor spaceId={space.id} spaceSlug={space.slug} documentId={document.id} title={document.title} sourcePath={sourcePath} initialSource={document.body} initialRevision={document.revision} format={document.format} revisions={revisions} savedDraft={draft ? { source: draft.source, baseRevision: draft.base_revision } : undefined} /></main>
}
