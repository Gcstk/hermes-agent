import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AnnotationMarkdown } from '@/components/annotation-markdown'

describe('AnnotationMarkdown', () => {
  it('renders annotation Markdown with the same rich semantics used while editing', () => {
    const html = renderToStaticMarkup(createElement(AnnotationMarkdown, {
      body: '**重点**\n\n- 待验证\n\n公式：$E = mc^2$',
    }))

    expect(html).toContain('<strong>重点</strong>')
    expect(html).toContain('<li>待验证</li>')
    expect(html).toContain('class="katex"')
  })

  it('does not execute raw HTML from annotation content', () => {
    const html = renderToStaticMarkup(createElement(AnnotationMarkdown, {
      body: '<script>alert(1)</script>\n\n安全内容',
    }))

    expect(html).not.toContain('<script>')
    expect(html).toContain('安全内容')
  })
})
