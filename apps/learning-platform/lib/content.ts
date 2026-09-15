import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'

import { assertAllowedContentRoot } from '@/lib/paths'
import type { DocumentMeta, LearningDocument, LearningSpace } from '@/lib/types'

const CONTENT_EXTENSIONS = new Set(['.md', '.mdx', '.html'])

function normalizeSlug(relativePath: string): string {
  const extension = path.extname(relativePath)
  const withoutExtension = relativePath.slice(0, -extension.length)
  return withoutExtension === 'README' ? 'index' : withoutExtension.replaceAll(path.sep, '/')
}

function extractTitle(body: string, fallback: string): string {
  const match = body.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() || fallback
}

function extractHeadings(body: string): LearningDocument['headings'] {
  return [...body.matchAll(/^(#{1,4})\s+(.+)$/gm)].map((match) => ({
    depth: match[1].length,
    text: match[2].replace(/[`*_]/g, '').trim(),
    slug: match[2]
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-|-$/g, ''),
  }))
}

async function collectFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(root, absolute))
    if (entry.isFile() && CONTENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(absolute)
    }
  }
  return files
}

export async function listDocuments(
  space: LearningSpace,
  options?: { includeUnpublished?: boolean },
): Promise<DocumentMeta[]> {
  const root = assertAllowedContentRoot(space.contentRoot)
  const files = await collectFiles(root)
  const documents = await Promise.all(files.map(async (file): Promise<DocumentMeta> => {
    const raw = await readFile(file, 'utf8')
    const parsed = matter(raw)
    const fileStats = await stat(file)
    const relativePath = path.relative(root, file)
    const slug = normalizeSlug(relativePath)
    const extension = path.extname(file).toLowerCase()
    const status = parsed.data.status === 'draft' || parsed.data.status === 'archived'
      ? parsed.data.status
      : 'published'
    return {
      id: slug,
      slug,
      title: String(parsed.data.title || extractTitle(parsed.content, path.basename(file, extension))),
      summary: String(parsed.data.summary || parsed.content.replace(/[#>*`\[\]]/g, '').trim().slice(0, 180)),
      status,
      order: Number(parsed.data.order ?? (slug === 'index' ? 0 : 100)),
      tags: Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [],
      estimatedMinutes: parsed.data.estimatedMinutes ? Number(parsed.data.estimatedMinutes) : undefined,
      path: relativePath.split(path.sep).join('/'),
      format: extension === '.html' ? 'html' : extension === '.mdx' ? 'mdx' : 'markdown',
      updatedAt: fileStats.mtime.toISOString(),
    }
  }))
  return documents
    .filter((document) => options?.includeUnpublished || document.status === 'published')
    .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title))
}

export async function getDocument(
  space: LearningSpace,
  slug: string,
  options?: { includeUnpublished?: boolean },
): Promise<LearningDocument | null> {
  const documents = await listDocuments(space, options)
  const metadata = documents.find((document) => document.slug === slug)
  if (!metadata) return null
  const root = assertAllowedContentRoot(space.contentRoot)
  const raw = await readFile(path.join(root, metadata.path), 'utf8')
  const parsed = matter(raw)
  return {
    ...metadata,
    body: parsed.content,
    revision: createHash('sha256').update(raw).digest('hex'),
    headings: extractHeadings(parsed.content),
  }
}
