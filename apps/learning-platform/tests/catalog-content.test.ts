import { describe, expect, it } from 'vitest'

import { listSpaces } from '@/lib/catalog'
import { getDocument, listDocuments } from '@/lib/content'

describe('catalog-driven learning spaces', () => {
  it('loads all configured published spaces without a hard-coded catalog size', async () => {
    const spaces = await listSpaces()
    const slugs = new Set(spaces.map((space) => space.slug))
    for (const expected of ['hermes', 'vllm', 'cs336']) expect(slugs.has(expected)).toBe(true)
    expect(new Set(spaces.map((space) => space.id)).size).toBe(spaces.length)
    expect(slugs.size).toBe(spaces.length)
  })

  it('keeps repeated document slugs scoped by space identity', async () => {
    const spaces = await listSpaces()
    const vllm = spaces.find((space) => space.slug === 'vllm')
    const cs336 = spaces.find((space) => space.slug === 'cs336')
    expect(vllm).toBeDefined()
    expect(cs336).toBeDefined()
    const [vllmIndex, cs336Index] = await Promise.all([
      getDocument(vllm!, 'index'),
      getDocument(cs336!, 'index'),
    ])
    expect(vllmIndex?.id).toBe('index')
    expect(cs336Index?.id).toBe('index')
    expect(vllm?.id).not.toBe(cs336?.id)
  })

  it('maps the existing Hermes documents without requiring a directory migration', async () => {
    const hermes = (await listSpaces()).find((space) => space.slug === 'hermes')
    expect(hermes?.contentRoot).toBe('docs/agent-harness-learning')
    const documents = await listDocuments(hermes!)
    expect(documents.some((document) => document.slug === 'index')).toBe(true)
    expect(documents.every((document) => document.status === 'published')).toBe(true)
  })
})
