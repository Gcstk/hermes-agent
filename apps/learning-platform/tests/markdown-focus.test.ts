import { describe, expect, it } from 'vitest'

import { markdownDelimitersForFormats } from '@/components/markdown-focus-plugin'

describe('markdownDelimitersForFormats', () => {
  it('reveals familiar Markdown delimiters for focused inline formatting', () => {
    expect(markdownDelimitersForFormats(['bold'])).toEqual({ prefix: '**', suffix: '**' })
    expect(markdownDelimitersForFormats(['bold', 'italic'])).toEqual({ prefix: '***', suffix: '***' })
    expect(markdownDelimitersForFormats(['strikethrough'])).toEqual({ prefix: '~~', suffix: '~~' })
  })

  it('treats inline code as a literal span instead of nesting visual formats inside it', () => {
    expect(markdownDelimitersForFormats(['bold', 'code'])).toEqual({ prefix: '`', suffix: '`' })
  })
})
