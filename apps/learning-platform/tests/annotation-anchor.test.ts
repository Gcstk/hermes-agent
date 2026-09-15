import { describe, expect, it } from 'vitest'

import { resolveTextAnchor } from '@/lib/annotation-anchor'
import type { AnnotationTarget } from '@/lib/types'

function target(overrides: Partial<AnnotationTarget> = {}): AnnotationTarget {
  return {
    blockId: 'p-12',
    revision: 'abc123',
    quote: { exact: 'prompt cache', prefix: 'sacred: ', suffix: ' stays stable' },
    position: { start: 8, end: 20 },
    ...overrides,
  }
}

describe('resolveTextAnchor', () => {
  it('uses the stored position while the text is unchanged', () => {
    expect(resolveTextAnchor('sacred: prompt cache stays stable', target())).toEqual({
      start: 8,
      end: 20,
      strategy: 'position',
    })
  })

  it('relocates an annotation after surrounding content is inserted', () => {
    expect(resolveTextAnchor('new context; sacred: prompt cache stays stable', target())).toEqual({
      start: 21,
      end: 33,
      strategy: 'quote',
    })
  })

  it('leaves an ambiguous or removed quote orphaned', () => {
    const ambiguous = target({ quote: { exact: 'cache', prefix: '', suffix: '' }, position: { start: 99, end: 104 } })
    expect(resolveTextAnchor('cache, then cache', ambiguous)).toBeNull()
    expect(resolveTextAnchor('the phrase disappeared', target())).toBeNull()
  })
})
