'use client'

import { Bot, Check, Highlighter, Languages, MessageSquareText, Trash2, X } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { AnnotationMarkdown } from '@/components/annotation-markdown'
import { resolveTextAnchor } from '@/lib/annotation-anchor'
import {
  placeAnnotationComposer,
  placeSelectionToolbar,
  type SelectionRectangle,
} from '@/lib/annotation-composer'
import type {
  Annotation,
  AnnotationTarget,
  SelectionAssistantAction,
  SelectionAssistantRequest,
  SelectionAssistantResponse,
} from '@/lib/types'

const AnnotationEditor = dynamic(
  () => import('@/components/mdx-editor-inner').then((module) => module.MdxEditorInner),
  { ssr: false, loading: () => <div className="annotation-editor-loading">正在加载 Markdown 编辑器…</div> },
)

interface SelectionToolbar {
  target: AnnotationTarget
  rectangle: SelectionRectangle
  x: number
  y: number
}

interface PendingSelection {
  target: AnnotationTarget
  x: number
  y: number
}

function textNodes(element: Element): Text[] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let node = walker.nextNode()
  while (node) {
    nodes.push(node as Text)
    node = walker.nextNode()
  }
  return nodes
}

function offsetsWithin(element: Element, range: Range): { start: number; end: number } {
  let cursor = 0
  let start = 0
  let end = 0
  for (const node of textNodes(element)) {
    const length = node.data.length
    if (node === range.startContainer) start = cursor + range.startOffset
    if (node === range.endContainer) end = cursor + range.endOffset
    cursor += length
  }
  return { start, end }
}

function rangeFromOffsets(element: Element, start: number, end: number): Range | null {
  const range = document.createRange()
  let cursor = 0
  let startSet = false
  for (const node of textNodes(element)) {
    const next = cursor + node.data.length
    if (!startSet && start >= cursor && start <= next) {
      range.setStart(node, Math.max(0, start - cursor))
      startSet = true
    }
    if (startSet && end >= cursor && end <= next) {
      range.setEnd(node, Math.max(0, end - cursor))
      return range
    }
    cursor = next
  }
  return null
}

function locateAnnotation(target: AnnotationTarget): Range | null {
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(target.blockId) : target.blockId
  const block = document.querySelector(`[data-block-id="${escaped}"]`)
  if (!block) return null
  const text = block.textContent ?? ''
  const resolved = resolveTextAnchor(text, target)
  return resolved ? rangeFromOffsets(block, resolved.start, resolved.end) : null
}

export function AnnotationPanel({
  spaceSlug,
  documentId,
  revision,
}: {
  spaceSlug: string
  documentId: string
  revision: string
}) {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbar | null>(null)
  const [pending, setPending] = useState<PendingSelection | null>(null)
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [assistantAction, setAssistantAction] = useState<SelectionAssistantAction | null>(null)
  const [assistantMessage, setAssistantMessage] = useState<string | null>(null)

  const loadAnnotations = useCallback(async () => {
    const response = await fetch(`/api/spaces/${spaceSlug}/annotations?document=${encodeURIComponent(documentId)}`)
    if (response.ok) setAnnotations(await response.json())
    setLoading(false)
  }, [documentId, spaceSlug])

  useEffect(() => { void loadAnnotations() }, [loadAnnotations])

  useEffect(() => {
    const highlightRegistry = (CSS as typeof CSS & { highlights?: Map<string, unknown> }).highlights
    const HighlightConstructor = (window as typeof window & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    if (!highlightRegistry || !HighlightConstructor) return
    const ranges: Range[] = []
    for (const annotation of annotations.filter((item) => item.status !== 'resolved')) {
      const range = locateAnnotation(annotation.target)
      if (range) ranges.push(range)
      else if (annotation.status === 'active') {
        void fetch(`/api/spaces/${spaceSlug}/annotations/${annotation.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'orphaned' }),
        })
      }
    }
    highlightRegistry.set('private-notes', new HighlightConstructor(...ranges))
    return () => { highlightRegistry.delete('private-notes') }
  }, [annotations, spaceSlug])

  useEffect(() => {
    function captureSelection(event: MouseEvent) {
      const eventTarget = event.target instanceof Element ? event.target : null
      if (eventTarget?.closest('[data-selection-overlay]')) return
      const article = document.getElementById('learning-article')
      if (!article || !eventTarget || !article.contains(eventTarget)) {
        setSelectionToolbar(null)
        return
      }
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setSelectionToolbar(null)
        return
      }
      const range = selection.getRangeAt(0)
      const element = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer as Element
      const block = element?.closest('[data-block-id]')
      if (!block || !block.contains(range.startContainer) || !block.contains(range.endContainer)) {
        setSelectionToolbar(null)
        return
      }
      const selected = selection.toString()
      const exact = selected.trim()
      if (!exact || exact.length > 500) {
        setSelectionToolbar(null)
        return
      }
      const rawPosition = offsetsWithin(block, range)
      const leadingWhitespace = selected.length - selected.trimStart().length
      const position = {
        start: rawPosition.start + leadingWhitespace,
        end: rawPosition.start + leadingWhitespace + exact.length,
      }
      const text = block.textContent ?? ''
      const rectangle = range.getBoundingClientRect()
      const toolbarPosition = placeSelectionToolbar(rectangle, {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      })
      const target: AnnotationTarget = {
        blockId: block.getAttribute('data-block-id') ?? '',
        revision,
        quote: {
          exact,
          prefix: text.slice(Math.max(0, position.start - 32), position.start),
          suffix: text.slice(position.end, position.end + 32),
        },
        position,
      }
      setBody('')
      setPending(null)
      setAssistantMessage(null)
      setSelectionToolbar({
        target,
        rectangle: {
          left: rectangle.left,
          right: rectangle.right,
          top: rectangle.top,
          bottom: rectangle.bottom,
        },
        x: toolbarPosition.left,
        y: toolbarPosition.top,
      })
    }
    document.addEventListener('mouseup', captureSelection)
    return () => document.removeEventListener('mouseup', captureSelection)
  }, [revision])

  function beginAnnotation() {
    if (!selectionToolbar) return
    const composerPosition = placeAnnotationComposer(selectionToolbar.rectangle, {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    })
    setPending({ target: selectionToolbar.target, x: composerPosition.left, y: composerPosition.top })
    setSelectionToolbar(null)
    setAssistantMessage(null)
  }

  async function requestSelectionAssistant(action: SelectionAssistantAction) {
    if (!selectionToolbar || assistantAction) return
    setAssistantAction(action)
    setAssistantMessage(null)
    try {
      const payload: SelectionAssistantRequest = {
        action,
        documentId,
        selection: selectionToolbar.target,
      }
      const response = await fetch(`/api/spaces/${spaceSlug}/selection-assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json().catch(() => null) as
        | (Partial<SelectionAssistantResponse> & { error?: string })
        | null
      setAssistantMessage(result?.message ?? result?.error ?? '选区助手暂时不可用。')
    } catch {
      setAssistantMessage('选区助手暂时不可用。')
    } finally {
      setAssistantAction(null)
    }
  }

  async function createAnnotation() {
    if (!pending || !body.trim()) return
    const response = await fetch(`/api/spaces/${spaceSlug}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId, target: pending.target, body: body.trim(), color: 'cyan' }),
    })
    if (response.ok) {
      setBody('')
      setPending(null)
      window.getSelection()?.removeAllRanges()
      await loadAnnotations()
    }
  }

  async function updateAnnotation(id: string, values: Record<string, string>) {
    const response = await fetch(`/api/spaces/${spaceSlug}/annotations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    })
    if (response.ok) await loadAnnotations()
  }

  async function deleteAnnotation(id: string) {
    if (!window.confirm('删除这条批注？')) return
    const response = await fetch(`/api/spaces/${spaceSlug}/annotations/${id}`, { method: 'DELETE' })
    if (response.ok) await loadAnnotations()
  }

  return (
    <>
      <style>{'::highlight(private-notes) { background: color-mix(in srgb, var(--amber) 48%, transparent); color: inherit; text-decoration: underline; text-decoration-color: var(--amber); }'}</style>
      <div className="annotation-heading">
        <span><MessageSquareText size={17} />私有批注</span>
        <b>{annotations.filter((item) => item.status !== 'resolved').length}</b>
      </div>
      <p className="annotation-help">选择正文文字后，从浮动菜单添加只对你可见的批注。</p>
      <div className="annotation-list">
        {loading && <p className="muted-state">正在加载批注…</p>}
        {!loading && annotations.length === 0 && <p className="muted-state">还没有批注。选中文字后点击“批注”即可记录。</p>}
        {annotations.map((annotation) => (
          <article className={`annotation-card status-${annotation.status}`} key={annotation.id}>
            <button className="quote-button" type="button" onClick={() => {
              const range = locateAnnotation(annotation.target)
              range?.startContainer.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }}>
              “{annotation.target.quote.exact}”
            </button>
            <AnnotationMarkdown body={annotation.body} />
            <footer>
              <span>{annotation.status === 'orphaned' ? '原文位置已变化' : annotation.status === 'resolved' ? '已解决' : '进行中'}</span>
              <div>
                <button type="button" onClick={() => void updateAnnotation(annotation.id, { status: annotation.status === 'resolved' ? 'active' : 'resolved' })} aria-label="切换解决状态"><Check size={14} /></button>
                <button type="button" onClick={() => void deleteAnnotation(annotation.id)} aria-label="删除批注"><Trash2 size={14} /></button>
              </div>
            </footer>
          </article>
        ))}
      </div>

      {selectionToolbar && createPortal(
        <div
          className="selection-action-popover"
          data-selection-overlay
          style={{ left: selectionToolbar.x, top: selectionToolbar.y }}
        >
          <div className="selection-action-menu" role="toolbar" aria-label="选中文字操作">
            <button type="button" onClick={beginAnnotation}><Highlighter size={15} />批注</button>
            <button type="button" disabled={assistantAction !== null} onClick={() => void requestSelectionAssistant('translate')}>
              <Languages size={15} />{assistantAction === 'translate' ? '请求中…' : '翻译'}
            </button>
            <button type="button" disabled={assistantAction !== null} onClick={() => void requestSelectionAssistant('ask-ai')}>
              <Bot size={15} />{assistantAction === 'ask-ai' ? '请求中…' : '询问 AI'}
            </button>
          </div>
          {assistantMessage && <p className="selection-action-message" role="status">{assistantMessage}</p>}
        </div>,
        document.body,
      )}

      {pending && createPortal(
        <div className="annotation-composer" data-selection-overlay role="dialog" aria-label="添加私有批注" style={{ left: pending.x, top: pending.y }}>
          <div className="annotation-composer-heading"><Highlighter size={16} /><strong>为选中文字添加批注</strong><button type="button" onClick={() => setPending(null)} aria-label="关闭"><X size={15} /></button></div>
          <blockquote>{pending.target.quote.exact}</blockquote>
          <div className="annotation-markdown-editor">
            <AnnotationEditor
              autoFocus
              className="annotation-mdx-editor"
              markdown={body}
              onChange={setBody}
              showToolbar={false}
              placeholder="记录你的理解、疑问或待验证事项…"
            />
          </div>
          <p className="annotation-format-hint">支持 Markdown 快捷输入、列表、链接、代码和 LaTeX 公式</p>
          <button className="primary-button" type="button" disabled={!body.trim()} onClick={() => void createAnnotation()}>保存批注</button>
        </div>,
        document.body,
      )}
    </>
  )
}
