'use client'

import { useEffect } from 'react'

import type { SearchResult } from '@/lib/types'

interface ModelContextTool {
  name: string
  title: string
  description: string
  inputSchema: object
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }
  execute(input: unknown): Promise<unknown>
}

interface ModelContext {
  registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal }): void | Promise<void>
}

declare global {
  interface Document {
    readonly modelContext?: ModelContext
  }
}

function readSearchInput(input: unknown): { query: string; space?: string; category?: string; tag?: string } {
  if (!input || typeof input !== 'object') throw new Error('Search input must be an object')
  const record = input as Record<string, unknown>
  if (typeof record.query !== 'string' || !record.query.trim() || record.query.length > 200) {
    throw new Error('query must be a non-empty string of at most 200 characters')
  }
  for (const key of ['space', 'category', 'tag'] as const) {
    if (record[key] !== undefined && typeof record[key] !== 'string') throw new Error(`${key} must be a string`)
  }
  return {
    query: record.query.trim(),
    space: record.space as string | undefined,
    category: record.category as string | undefined,
    tag: record.tag as string | undefined,
  }
}

export function WebMcpTools() {
  useEffect(() => {
    const context = document.modelContext
    if (!context?.registerTool) return
    const lifecycle = new AbortController()
    const tool: ModelContextTool = {
      name: 'search_learning_content',
      title: '搜索学习内容',
      description: '只读搜索已发布的学习文章，可按学习空间、分类或标签缩小范围。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 200 },
          space: { type: 'string', description: '可选的学习空间 slug' },
          category: { type: 'string', description: '可选的分类名称' },
          tag: { type: 'string', description: '可选的标签' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        const values = readSearchInput(input)
        const parameters = new URLSearchParams({ q: values.query })
        if (values.space) parameters.set('space', values.space)
        if (values.category) parameters.set('category', values.category)
        if (values.tag) parameters.set('tag', values.tag)
        const response = await fetch(`/api/search?${parameters}`)
        if (!response.ok) throw new Error(`Search failed with status ${response.status}`)
        const results = await response.json() as SearchResult[]
        return {
          count: results.length,
          results: results.slice(0, 20).map((result) => ({
            space: result.spaceTitle,
            path: `/spaces/${result.spaceSlug}/learn/${result.documentSlug}`,
            title: result.title,
            excerpt: result.excerpt || result.summary,
          })),
        }
      },
    }
    try {
      void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined)
    } catch {
      lifecycle.abort()
    }
    return () => lifecycle.abort()
  }, [])

  return null
}
