import { notFound } from 'next/navigation'

import { ArticleLayout } from '@/components/article-layout'
import { HtmlDocument } from '@/components/html-document'
import { MarkdownContent } from '@/components/markdown-content'
import { isAdmin } from '@/lib/auth'
import { getSpace } from '@/lib/catalog'
import { getDocument, listDocuments } from '@/lib/content'

export const dynamic = 'force-dynamic'

export default async function DocumentPage({ params }: { params: Promise<{ spaceSlug: string; documentSlug: string[] }> }) {
  const { spaceSlug, documentSlug } = await params
  const space = await getSpace(spaceSlug)
  if (!space) notFound()
  const slug = documentSlug.join('/')
  const [document, documents, owner] = await Promise.all([
    getDocument(space, slug),
    listDocuments(space),
    isAdmin(),
  ])
  if (!document) notFound()
  const sourcePath = `${space.contentRoot}/${document.path}`

  return (
    <ArticleLayout space={space} document={document} documents={documents} isOwner={owner}>
      {document.format === 'html'
        ? <HtmlDocument html={document.body} />
        : <MarkdownContent body={document.body} sourcePath={sourcePath} spaceSlug={space.slug} />}
    </ArticleLayout>
  )
}
