import { getSpace } from '@/lib/catalog'
import { listDocuments } from '@/lib/content'
import { jsonError } from '@/lib/http'

export async function GET(_request: Request, context: { params: Promise<{ spaceSlug: string }> }) {
  const { spaceSlug } = await context.params
  const space = await getSpace(spaceSlug)
  return space ? Response.json(await listDocuments(space)) : jsonError('学习空间不存在', 404)
}
