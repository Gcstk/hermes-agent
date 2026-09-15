import { describe, expect, it } from 'vitest'

import { sanitizeHtml } from '@/components/html-document'

describe('HTML learning content', () => {
  it('removes active content before rendering in a sandboxed frame', async () => {
    const output = await sanitizeHtml('<main><h1>Safe</h1><script>alert(1)</script><a href="javascript:alert(2)">bad</a></main>')
    expect(output).toContain('<h1>Safe</h1>')
    expect(output).not.toContain('<script')
    expect(output).not.toContain('javascript:')
  })
})
