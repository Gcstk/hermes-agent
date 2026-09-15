import { searchDocuments } from '@/lib/search'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const query = (params.get('query') ?? params.get('q'))?.trim() ?? ''
  if (!query) return Response.json([])
  return Response.json(await searchDocuments(query, {
    spaceSlug: params.get('space') || undefined,
    category: params.get('category') || undefined,
    tag: params.get('tag') || undefined,
  }))
}
