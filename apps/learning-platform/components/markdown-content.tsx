import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import { MermaidDiagram } from '@/components/mermaid-diagram'

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'details', 'summary', 'kbd', 'mark'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className', 'id'],
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-/]],
  },
}

function textOf(children: unknown): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(textOf).join('')
  return ''
}

function headingSlug(children: unknown): string {
  return textOf(children).toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-|-$/g, '')
}

function blockId(node: { position?: { start: { line: number } } } | undefined, prefix: string): string {
  return `${prefix}-${node?.position?.start.line ?? 'unknown'}`
}

function resolveHref(href: string | undefined, sourcePath: string, spaceSlug: string): string | undefined {
  if (!href || /^(https?:|mailto:|#)/.test(href)) return href
  const sourceDirectory = sourcePath.split('/').slice(0, -1)
  const segments = [...sourceDirectory, ...href.split('/')]
  const normalized: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') normalized.pop()
    else normalized.push(segment)
  }
  const repositoryPath = normalized.join('/')
  if (/\.(md|mdx)$/i.test(href)) {
    const contentMarker = sourcePath.includes('agent-harness-learning')
      ? 'docs/agent-harness-learning/'
      : `docs/learning-spaces/${spaceSlug}/`
    if (repositoryPath.startsWith(contentMarker)) {
      const documentPath = repositoryPath.slice(contentMarker.length).replace(/\.(md|mdx)$/i, '')
      const slug = documentPath === 'README' ? 'index' : documentPath
      return `/spaces/${spaceSlug}/learn/${slug}`
    }
  }
  return `https://github.com/NousResearch/Hermes-Agent/blob/main/${repositoryPath}`
}

function resolveImageSource(source: string | undefined, sourcePath: string, spaceSlug: string): string | undefined {
  if (!source || /^(https?:|data:)/.test(source)) return source
  const contentMarker = sourcePath.includes('agent-harness-learning')
    ? 'docs/agent-harness-learning/'
    : `docs/learning-spaces/${spaceSlug}/`
  const sourceWithinSpace = sourcePath.startsWith(contentMarker)
    ? sourcePath.slice(contentMarker.length)
    : sourcePath
  const sourceDirectory = sourceWithinSpace.split('/').slice(0, -1)
  const segments: string[] = []
  for (const segment of [...sourceDirectory, ...source.split('/')]) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return `/api/spaces/${spaceSlug}/assets/${segments.map(encodeURIComponent).join('/')}`
}

export function MarkdownContent({
  body,
  sourcePath,
  spaceSlug,
}: {
  body: string
  sourcePath: string
  spaceSlug: string
}) {
  const components: Components = {
    h1: ({ node, children, ...props }) => <h1 {...props} id={headingSlug(children)} data-block-id={blockId(node, 'h1')}>{children}</h1>,
    h2: ({ node, children, ...props }) => <h2 {...props} id={headingSlug(children)} data-block-id={blockId(node, 'h2')}>{children}</h2>,
    h3: ({ node, children, ...props }) => <h3 {...props} id={headingSlug(children)} data-block-id={blockId(node, 'h3')}>{children}</h3>,
    h4: ({ node, children, ...props }) => <h4 {...props} id={headingSlug(children)} data-block-id={blockId(node, 'h4')}>{children}</h4>,
    p: ({ node, children, ...props }) => <p {...props} data-block-id={blockId(node, 'p')}>{children}</p>,
    li: ({ node, children, ...props }) => <li {...props} data-block-id={blockId(node, 'li')}>{children}</li>,
    a: ({ href, children, ...props }) => {
      const resolved = resolveHref(href, sourcePath, spaceSlug)
      const external = Boolean(resolved?.startsWith('http'))
      return <a {...props} href={resolved} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>{children}</a>
    },
    img: ({ src, alt, ...props }) => <img {...props} src={resolveImageSource(typeof src === 'string' ? src : undefined, sourcePath, spaceSlug)} alt={alt ?? ''} loading="lazy" />,
    code: ({ className, children, ...props }) => {
      const language = /language-([\w-]+)/.exec(className ?? '')?.[1]
      if (language === 'mermaid') return <MermaidDiagram chart={String(children).replace(/\n$/, '')} />
      return <code {...props} className={className} data-language={language}>{children}</code>
    },
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeKatex]}
      components={components}
    >
      {body}
    </ReactMarkdown>
  )
}
