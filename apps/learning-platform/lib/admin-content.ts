import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import { z } from 'zod'

import { readCatalog, writeCatalog } from '@/lib/catalog'
import { getDocument } from '@/lib/content'
import { commitExact, readFileAtRevision } from '@/lib/git-publisher'
import { assertAllowedContentRoot, newSpaceRoot, toRepositoryRelative } from '@/lib/paths'
import type { LearningSpace, SpaceStatus } from '@/lib/types'

export const createSpaceSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug 只能包含小写字母、数字和连字符'),
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().min(10).max(500),
  category: z.string().trim().min(2).max(60),
  tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  accent: z.enum(['cyan', 'violet', 'amber', 'blue']).default('blue'),
})

export const updateSpaceSchema = z.object({
  title: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().min(10).max(500).optional(),
  category: z.string().trim().min(2).max(60).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(12).optional(),
  cover: z.string().trim().max(300).optional(),
  accent: z.enum(['cyan', 'violet', 'amber', 'blue']).optional(),
  featured: z.boolean().optional(),
  order: z.number().int().min(0).max(100_000).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
}).refine((values) => Object.keys(values).length > 0, '模块更新为空')

async function atomicWrite(destination: string, content: string): Promise<void> {
  const temporary = `${destination}.${process.pid}.tmp`
  await writeFile(temporary, content, 'utf8')
  await rename(temporary, destination)
}

function hashSource(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}

export async function createLearningSpace(input: z.infer<typeof createSpaceSchema>): Promise<{ space: LearningSpace; revision: string }> {
  const values = createSpaceSchema.parse(input)
  const catalog = await readCatalog()
  if (catalog.spaces.some((space) => space.slug === values.slug)) throw new Error('这个 slug 已被使用')
  const now = new Date().toISOString()
  const contentRoot = `docs/learning-spaces/${values.slug}`
  const absoluteRoot = path.join(newSpaceRoot, values.slug)
  await mkdir(absoluteRoot, { recursive: false })
  assertAllowedContentRoot(contentRoot)
  const space: LearningSpace = {
    id: randomUUID(),
    slug: values.slug,
    title: values.title,
    description: values.description,
    category: values.category,
    tags: values.tags,
    contentRoot,
    entryDocument: 'README.md',
    status: 'draft',
    featured: false,
    order: Math.max(0, ...catalog.spaces.map((item) => item.order)) + 10,
    accent: values.accent,
    createdAt: now,
    updatedAt: now,
  }
  const readme = matter.stringify(`# ${values.title}\n\n${values.description}\n\n## 学习地图\n\n在这里开始组织第一条学习路径。\n`, {
    title: `${values.title} 学习地图`,
    summary: values.description,
    status: 'draft',
    order: 1,
    tags: values.tags,
  })
  await atomicWrite(path.join(absoluteRoot, 'README.md'), readme)
  await writeCatalog({ ...catalog, spaces: [...catalog.spaces, space] })
  const revision = await commitExact([
    'docs/learning-platform/catalog.yaml',
    `${contentRoot}/README.md`,
  ], `docs(learning): create ${values.title} space`)
  return { space, revision }
}

export async function updateSpaceStatus(spaceId: string, status: SpaceStatus): Promise<{ space: LearningSpace; revision: string }> {
  return updateLearningSpace(spaceId, { status })
}

export async function updateLearningSpace(spaceId: string, input: z.infer<typeof updateSpaceSchema>): Promise<{ space: LearningSpace; revision: string }> {
  const values = updateSpaceSchema.parse(input)
  const catalog = await readCatalog()
  const index = catalog.spaces.findIndex((space) => space.id === spaceId)
  if (index < 0) throw new Error('学习空间不存在')
  const space: LearningSpace = { ...catalog.spaces[index], ...values, updatedAt: new Date().toISOString() }
  if ('cover' in values) space.cover = values.cover || undefined
  const spaces = [...catalog.spaces]
  spaces[index] = space
  await writeCatalog({ ...catalog, spaces })
  const revision = await commitExact(['docs/learning-platform/catalog.yaml'], `docs(learning): update ${space.title}`)
  return { space, revision }
}

export async function saveDraft(space: LearningSpace, documentId: string, source: string, baseRevision: string, format: string): Promise<void> {
  if (source.length > 2_000_000) throw new Error('文档超过 2 MB 限制')
  const document = await getDocument(space, documentId, { includeUnpublished: true })
  if (!document) throw new Error('文档不存在')
  if (format !== document.format) throw new Error('草稿格式与原文不一致')
  const now = new Date().toISOString()
  const { getDatabase } = await import('@/lib/db')
  getDatabase().prepare(`
    INSERT INTO document_drafts(space_id, document_id, base_revision, source, format, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(space_id, document_id) DO UPDATE SET
      base_revision = excluded.base_revision, source = excluded.source,
      format = excluded.format, updated_at = excluded.updated_at
  `).run(space.id, documentId, baseRevision, source, format, now)
}

export async function publishDraft(space: LearningSpace, documentId: string, commitMessage: string): Promise<{ revision: string; documentRevision: string }> {
  const { getDatabase } = await import('@/lib/db')
  const draft = getDatabase().prepare('SELECT base_revision, source, format FROM document_drafts WHERE space_id = ? AND document_id = ?').get(space.id, documentId) as { base_revision: string; source: string; format: string } | undefined
  if (!draft) throw new Error('没有可发布的草稿')
  const mdxMarkup = draft.source.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  if (draft.format === 'mdx' && (/^\s*(import|export)\s/m.test(mdxMarkup) || /[{}]/.test(mdxMarkup) || /<[A-Z][\w.]*(?:\s|\/?>)/.test(mdxMarkup))) {
    throw new Error('首版 MDX 禁止 import、export 和可执行表达式')
  }
  const document = await getDocument(space, documentId, { includeUnpublished: true })
  if (!document) throw new Error('文档不存在')
  const absoluteRoot = assertAllowedContentRoot(space.contentRoot)
  const absolutePath = path.join(absoluteRoot, document.path)
  const currentRaw = await readFile(absolutePath, 'utf8')
  if (hashSource(currentRaw) !== draft.base_revision) throw new Error('原文已经变化，请刷新后重新合并草稿')
  const parsed = matter(currentRaw)
  const nextRaw = matter.stringify(draft.source.trimEnd() + '\n', parsed.data)
  await atomicWrite(absolutePath, nextRaw)
  const repositoryPath = toRepositoryRelative(absolutePath)
  const revision = await commitExact([repositoryPath], commitMessage.trim() || `docs(learning): update ${document.title}`)
  getDatabase().prepare('DELETE FROM document_drafts WHERE space_id = ? AND document_id = ?').run(space.id, documentId)
  return { revision, documentRevision: hashSource(nextRaw) }
}

export async function restoreDocument(space: LearningSpace, documentId: string, revision: string): Promise<{ revision: string }> {
  const document = await getDocument(space, documentId, { includeUnpublished: true })
  if (!document) throw new Error('文档不存在')
  const absolutePath = path.join(assertAllowedContentRoot(space.contentRoot), document.path)
  const repositoryPath = toRepositoryRelative(absolutePath)
  const historical = await readFileAtRevision(revision, repositoryPath)
  await atomicWrite(absolutePath, historical)
  const nextRevision = await commitExact([repositoryPath], `docs(learning): restore ${document.title} from ${revision.slice(0, 8)}`)
  return { revision: nextRevision }
}
