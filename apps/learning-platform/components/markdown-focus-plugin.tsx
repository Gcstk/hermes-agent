'use client'

import {
  addComposerChild$,
  addNestedEditorChild$,
  addTableCellEditorChild$,
  realmPlugin,
} from '@mdxeditor/editor'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  type EditorState,
  type TextFormatType,
  type TextNode,
} from 'lexical'
import { useEffect } from 'react'

interface MarkdownDelimiter {
  format: TextFormatType
  open: string
  close: string
}

interface MarkerPart {
  marker: string
  order: number
}

interface MarkerPlacement {
  key: string
  prefixes: MarkerPart[]
  suffixes: MarkerPart[]
}

const MARKDOWN_DELIMITERS: MarkdownDelimiter[] = [
  { format: 'bold', open: '**', close: '**' },
  { format: 'italic', open: '*', close: '*' },
  { format: 'strikethrough', open: '~~', close: '~~' },
  { format: 'highlight', open: '==', close: '==' },
  { format: 'subscript', open: '~', close: '~' },
  { format: 'superscript', open: '^', close: '^' },
  { format: 'underline', open: '<u>', close: '</u>' },
  { format: 'code', open: '`', close: '`' },
]

export function markdownDelimitersForFormats(formats: readonly TextFormatType[]): { prefix: string; suffix: string } {
  const active = new Set(formats)
  const delimiters = active.has('code')
    ? MARKDOWN_DELIMITERS.filter((item) => item.format === 'code')
    : MARKDOWN_DELIMITERS.filter((item) => active.has(item.format))
  return {
    prefix: delimiters.map((item) => item.open).join(''),
    suffix: [...delimiters].reverse().map((item) => item.close).join(''),
  }
}

function findRunBoundary(node: TextNode, format: TextFormatType, direction: 'previous' | 'next'): TextNode {
  let boundary = node
  let sibling = direction === 'previous' ? boundary.getPreviousSibling() : boundary.getNextSibling()
  while ($isTextNode(sibling) && sibling.hasFormat(format)) {
    boundary = sibling
    sibling = direction === 'previous' ? boundary.getPreviousSibling() : boundary.getNextSibling()
  }
  return boundary
}

function markerPlacements(editorState: EditorState): MarkerPlacement[] {
  return editorState.read(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return []
    const activeNode = selection.anchor.getNode()
    if (!$isTextNode(activeNode)) return []

    const activeDelimiters = activeNode.hasFormat('code')
      ? MARKDOWN_DELIMITERS.filter((item) => item.format === 'code')
      : MARKDOWN_DELIMITERS.filter((item) => activeNode.hasFormat(item.format))
    const placements = new Map<string, MarkerPlacement>()

    function placementFor(key: string): MarkerPlacement {
      const existing = placements.get(key)
      if (existing) return existing
      const placement = { key, prefixes: [], suffixes: [] }
      placements.set(key, placement)
      return placement
    }

    activeDelimiters.forEach((delimiter, order) => {
      const first = findRunBoundary(activeNode, delimiter.format, 'previous')
      const last = findRunBoundary(activeNode, delimiter.format, 'next')
      placementFor(first.getKey()).prefixes.push({ marker: delimiter.open, order })
      placementFor(last.getKey()).suffixes.push({ marker: delimiter.close, order })
    })

    return Array.from(placements.values())
  })
}

function MarkdownFocusPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    let decoratedElements = new Set<HTMLElement>()
    let animationFrame = 0

    function clearMarkers(): void {
      window.cancelAnimationFrame(animationFrame)
      for (const element of decoratedElements) {
        element.removeAttribute('data-markdown-prefix')
        element.removeAttribute('data-markdown-suffix')
        element.classList.remove('markdown-source-active')
      }
      decoratedElements = new Set()
    }

    function showMarkers(editorState: EditorState): void {
      window.cancelAnimationFrame(animationFrame)
      const root = editor.getRootElement()
      if (!root?.contains(document.activeElement)) {
        clearMarkers()
        return
      }
      const placements = markerPlacements(editorState)
      animationFrame = window.requestAnimationFrame(() => {
        clearMarkers()
        for (const placement of placements) {
          const element = editor.getElementByKey(placement.key)
          if (!element) continue
          const prefix = [...placement.prefixes]
            .sort((left, right) => left.order - right.order)
            .map((part) => part.marker)
            .join('')
          const suffix = [...placement.suffixes]
            .sort((left, right) => right.order - left.order)
            .map((part) => part.marker)
            .join('')
          if (prefix) element.setAttribute('data-markdown-prefix', prefix)
          if (suffix) element.setAttribute('data-markdown-suffix', suffix)
          element.classList.add('markdown-source-active')
          decoratedElements.add(element)
        }
      })
    }

    function bindRoot(root: HTMLElement | null, previousRoot: HTMLElement | null): void {
      previousRoot?.removeEventListener('focusout', handleFocusOut)
      previousRoot?.removeEventListener('focusin', handleFocusIn)
      root?.addEventListener('focusout', handleFocusOut)
      root?.addEventListener('focusin', handleFocusIn)
    }

    function handleFocusOut(event: FocusEvent): void {
      const root = editor.getRootElement()
      if (!root?.contains(event.relatedTarget as Node | null)) clearMarkers()
    }

    function handleFocusIn(): void {
      showMarkers(editor.getEditorState())
    }

    const removeRootListener = editor.registerRootListener(bindRoot)
    const removeUpdateListener = editor.registerUpdateListener(({ editorState }) => showMarkers(editorState))

    return () => {
      removeRootListener()
      removeUpdateListener()
      editor.getRootElement()?.removeEventListener('focusout', handleFocusOut)
      editor.getRootElement()?.removeEventListener('focusin', handleFocusIn)
      clearMarkers()
    }
  }, [editor])

  return null
}

export const markdownFocusPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addComposerChild$]: MarkdownFocusPlugin,
      [addNestedEditorChild$]: MarkdownFocusPlugin,
      [addTableCellEditorChild$]: MarkdownFocusPlugin,
    })
  },
})
