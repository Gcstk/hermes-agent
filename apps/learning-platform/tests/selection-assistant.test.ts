import { describe, expect, it } from 'vitest'

import { selectionAssistantRequestSchema } from '@/lib/selection-assistant'

const validSelection = {
  blockId: 'paragraph-1',
  revision: '40ac073e',
  quote: {
    exact: 'Agent Loop',
    prefix: '理解 ',
    suffix: ' 的状态迁移',
  },
  position: { start: 3, end: 13 },
}

describe('selectionAssistantRequestSchema', () => {
  it.each(['translate', 'ask-ai'] as const)('accepts the %s selection action contract', (action) => {
    const parsed = selectionAssistantRequestSchema.safeParse({
      action,
      documentId: '01-runtime',
      selection: validSelection,
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects unsupported actions and invalid selection ranges', () => {
    const unsupported = selectionAssistantRequestSchema.safeParse({
      action: 'summarize',
      documentId: '01-runtime',
      selection: validSelection,
    })
    const reversedRange = selectionAssistantRequestSchema.safeParse({
      action: 'translate',
      documentId: '01-runtime',
      selection: { ...validSelection, position: { start: 13, end: 3 } },
    })

    expect(unsupported.success).toBe(false)
    expect(reversedRange.success).toBe(false)
  })
})
