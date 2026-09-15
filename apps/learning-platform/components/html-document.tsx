import rehypeParse from 'rehype-parse'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import { unified } from 'unified'

const htmlSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'details', 'summary', 'kbd', 'mark'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className', 'id'],
  },
}

export async function sanitizeHtml(html: string): Promise<string> {
  return String(await unified()
    .use(rehypeParse, { fragment: false })
    .use(rehypeSanitize, htmlSchema)
    .use(rehypeStringify)
    .process(html))
}

export async function HtmlDocument({ html }: { html: string }) {
  const sanitized = await sanitizeHtml(html)
  return (
    <iframe
      className="html-document"
      title="隔离的 HTML 学习内容"
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={sanitized}
    />
  )
}
