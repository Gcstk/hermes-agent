import { rename, writeFile, readFile } from 'node:fs/promises'
import YAML from 'yaml'
import { z } from 'zod'

import { catalogPath } from '@/lib/paths'
import type { LearningSpace, SpaceCatalog } from '@/lib/types'

const learningSpaceSchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  tags: z.array(z.string()),
  cover: z.string().optional(),
  contentRoot: z.string().min(1),
  entryDocument: z.string().optional(),
  status: z.enum(['draft', 'published', 'archived']),
  featured: z.boolean(),
  order: z.number().int(),
  accent: z.enum(['cyan', 'violet', 'amber', 'blue']).optional(),
  createdAt: z.union([z.string(), z.date()]).transform((value) =>
    value instanceof Date ? value.toISOString() : value,
  ),
  updatedAt: z.union([z.string(), z.date()]).transform((value) =>
    value instanceof Date ? value.toISOString() : value,
  ),
})

const catalogSchema = z.object({
  version: z.number().int().positive(),
  spaces: z.array(learningSpaceSchema),
})

export async function readCatalog(): Promise<SpaceCatalog> {
  const source = await readFile(catalogPath, 'utf8')
  const catalog = catalogSchema.parse(YAML.parse(source))
  const ids = new Set<string>()
  const slugs = new Set<string>()
  for (const space of catalog.spaces) {
    if (ids.has(space.id) || slugs.has(space.slug)) {
      throw new Error(`Duplicate learning-space id or slug: ${space.id}/${space.slug}`)
    }
    ids.add(space.id)
    slugs.add(space.slug)
  }
  return catalog
}

export async function listSpaces(options?: { includeUnpublished?: boolean }): Promise<LearningSpace[]> {
  const catalog = await readCatalog()
  return catalog.spaces
    .filter((space) => options?.includeUnpublished || space.status === 'published')
    .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title))
}

export async function getSpace(
  slug: string,
  options?: { includeUnpublished?: boolean },
): Promise<LearningSpace | null> {
  const spaces = await listSpaces(options)
  return spaces.find((space) => space.slug === slug) ?? null
}

export async function writeCatalog(catalog: SpaceCatalog): Promise<void> {
  const validated = catalogSchema.parse(catalog)
  const temporary = `${catalogPath}.${process.pid}.tmp`
  await writeFile(temporary, YAML.stringify(validated, { lineWidth: 120 }), 'utf8')
  await rename(temporary, catalogPath)
}
