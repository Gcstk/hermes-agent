import matter from 'gray-matter'

import { isAdmin } from '@/lib/auth'
import { readCatalog } from '@/lib/catalog'
import { getDocument } from '@/lib/content'
import { fileHistory, readFileAtRevision } from '@/lib/git-publisher'
import { jsonError } from '@/lib/http'

export async function GET(request: Request, context: { params: Promise<{ spaceId: string }> }) {
  if (!await isAdmin()) return jsonError('需要登录', 401)
  const { spaceId } = await context.params
  const url = new URL(request.url)
  const documentId = url.searchParams.get('document')
  const revision = url.searchParams.get('revision')
  if (!documentId || !revision) return jsonError('缺少文章或版本标识')

  const space = (await readCatalog()).spaces.find((item) => item.id === spaceId)
  if (!space) return jsonError('学习空间不存在', 404)
  const document = await getDocument(space, documentId, { includeUnpublished: true })
  if (!document) return jsonError('文章不存在', 404)

  const sourcePath = `${space.contentRoot}/${document.path}`
  const history = await fileHistory(sourcePath)
  const entry = history.find((item) => item.revision === revision)
  if (!entry) return jsonError('这个版本不在文章的可用历史中', 404)

  try {
    const raw = await readFileAtRevision(entry.revision, sourcePath)
    return Response.json({ ...entry, source: matter(raw).content })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '读取历史版本失败', 409)
  }
}
