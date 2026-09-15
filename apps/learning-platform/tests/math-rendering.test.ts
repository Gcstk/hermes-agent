import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MarkdownContent } from '@/components/markdown-content'
import { renderMathToHtml } from '@/components/math-editor-plugin'

describe('Markdown math rendering', () => {
  it('renders inline and block formulas without exposing their delimiters', () => {
    const html = renderToStaticMarkup(createElement(MarkdownContent, {
      body: '行内 $E=mc^2$。\n\n$$\n\\sum_{i=1}^{n} i\n$$',
      sourcePath: 'docs/learning-spaces/test/index.md',
      spaceSlug: 'test',
    }))

    expect(html).toContain('class="katex"')
    expect(html).toContain('class="katex-display"')
    expect(html).not.toContain('E=mc^2$')
  })

  it('preserves invalid formulas as an editable error instead of discarding them', () => {
    const result = renderMathToHtml('\\not-a-real-command{', true)

    expect(result.html).toBeUndefined()
    expect(result.error).toBeTruthy()
  })
})
