import { listSpaces } from '@/lib/catalog'
import { listDocuments } from '@/lib/content'

export async function GET() {
  const spaces = await listSpaces()
  return Response.json(await Promise.all(spaces.map(async (space) => ({
    ...space,
    documentCount: (await listDocuments(space)).length,
  }))))
}
