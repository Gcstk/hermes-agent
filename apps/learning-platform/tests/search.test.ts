import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(async () => {
  process.env.LEARNING_DATA_DIR = await mkdtemp(path.join(tmpdir(), 'learning-platform-search-'))
  vi.resetModules()
})

afterAll(() => {
  delete process.env.LEARNING_DATA_DIR
})

describe('cross-space search filters', () => {
  it('filters published results by space, category, and tag', async () => {
    const { searchDocuments } = await import('@/lib/search')
    const bySpace = await searchDocuments('PagedAttention', { spaceSlug: 'vllm' })
    const byCategory = await searchDocuments('PagedAttention', { category: 'Inference Systems' })
    const byTag = await searchDocuments('PagedAttention', { tag: 'vLLM' })
    expect(bySpace.length).toBeGreaterThan(0)
    expect(bySpace.every((result) => result.spaceSlug === 'vllm')).toBe(true)
    expect(byCategory.every((result) => result.category === 'Inference Systems')).toBe(true)
    expect(byTag.every((result) => result.tags.includes('vLLM'))).toBe(true)
  })

  it('supports short non-trigram queries through the fallback search', async () => {
    const { searchDocuments } = await import('@/lib/search')
    const results = await searchDocuments('图', { spaceSlug: 'vllm' })
    expect(Array.isArray(results)).toBe(true)
  })
})
