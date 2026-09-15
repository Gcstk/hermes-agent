'use client'

import {
  addComposerChild$,
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  addMdastExtension$,
  addNestedEditorChild$,
  addSyntaxExtension$,
  addTableCellEditorChild$,
  addToMarkdownExtension$,
  realmPlugin,
  type LexicalExportVisitor,
  type MdastImportVisitor,
} from '@mdxeditor/editor'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import katex from 'katex'
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  DecoratorNode,
  TextNode,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical'
import { mathFromMarkdown, mathToMarkdown, type InlineMath, type Math as MdastMath } from 'mdast-util-math'
import { math } from 'micromark-extension-math'
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'

interface SerializedMathNode extends Spread<{
  displayMode: boolean
  value: string
}, SerializedLexicalNode> {}

interface MathRenderResult {
  error?: string
  html?: string
}

export function renderMathToHtml(value: string, displayMode: boolean): MathRenderResult {
  try {
    return {
      html: katex.renderToString(value, {
        displayMode,
        output: 'htmlAndMathml',
        strict: false,
        throwOnError: true,
        trust: false,
      }),
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : '公式语法无效' }
  }
}

class MathNode extends DecoratorNode<JSX.Element> {
  __displayMode: boolean
  __value: string

  constructor(value: string, displayMode: boolean, key?: NodeKey) {
    super(key)
    this.__value = value
    this.__displayMode = displayMode
  }

  static getType(): string {
    return 'learning-math'
  }

  static clone(node: MathNode): MathNode {
    return new MathNode(node.__value, node.__displayMode, node.__key)
  }

  static importJSON(serializedNode: SerializedMathNode): MathNode {
    return new MathNode(serializedNode.value, serializedNode.displayMode)
  }

  exportJSON(): SerializedMathNode {
    return {
      ...super.exportJSON(),
      displayMode: this.__displayMode,
      type: 'learning-math',
      value: this.__value,
      version: 1,
    }
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement(this.__displayMode ? 'div' : 'span')
    element.className = this.__displayMode ? 'math-node-host is-block' : 'math-node-host is-inline'
    return element
  }

  updateDOM(previousNode: MathNode): boolean {
    return previousNode.__displayMode !== this.__displayMode
  }

  decorate(parentEditor: LexicalEditor): JSX.Element {
    return <MathNodeEditor
      displayMode={this.__displayMode}
      initialValue={this.__value}
      nodeKey={this.getKey()}
      parentEditor={parentEditor}
    />
  }

  getDisplayMode(): boolean {
    return this.getLatest().__displayMode
  }

  getValue(): string {
    return this.getLatest().__value
  }

  isInline(): boolean {
    return !this.__displayMode
  }

  setValue(value: string): void {
    this.getWritable().__value = value
  }
}

function $createMathNode(value: string, displayMode: boolean): MathNode {
  return new MathNode(value, displayMode)
}

function $isMathNode(node: LexicalNode | null | undefined): node is MathNode {
  return node instanceof MathNode
}

function MathNodeEditor({
  displayMode,
  initialValue,
  nodeKey,
  parentEditor,
}: {
  displayMode: boolean
  initialValue: string
  nodeKey: NodeKey
  parentEditor: LexicalEditor
}) {
  const [editing, setEditing] = useState(initialValue.length === 0)
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const rendered = useMemo(() => renderMathToHtml(value, displayMode), [displayMode, value])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function updateValue(nextValue: string): void {
    setValue(nextValue)
    parentEditor.update(() => {
      const node = $getNodeByKey<MathNode>(nodeKey)
      if ($isMathNode(node)) node.setValue(nextValue)
    })
  }

  function finishEditing(): void {
    setEditing(false)
  }

  if (editing) {
    const commonProps = {
      'aria-label': displayMode ? '块级公式 LaTeX 源码' : '行内公式 LaTeX 源码',
      className: 'math-node-source',
      onBlur: finishEditing,
      onClick: (event: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => event.stopPropagation(),
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateValue(event.target.value),
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (event.key === 'Escape' || (!displayMode && event.key === 'Enter') || (displayMode && event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
          event.preventDefault()
          finishEditing()
        }
      },
      onMouseDown: (event: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => event.stopPropagation(),
      placeholder: displayMode ? '输入 LaTeX，Ctrl/⌘ + Enter 完成' : '输入 LaTeX，Enter 完成',
      value,
    }
    const sourceInput = displayMode
      ? <textarea {...commonProps} ref={inputRef as React.RefObject<HTMLTextAreaElement | null>} rows={3} />
      : <input {...commonProps} ref={inputRef as React.RefObject<HTMLInputElement | null>} />
    const delimiter = displayMode ? '$$' : '$'
    const sourceEditorProps = {
      className: `math-source-editor ${displayMode ? 'is-block' : 'is-inline'}`,
      onClick: (event: React.MouseEvent) => event.stopPropagation(),
      onMouseDown: (event: React.MouseEvent) => event.stopPropagation(),
    }
    return displayMode
      ? <div {...sourceEditorProps}><span className="math-source-delimiter" aria-hidden>{delimiter}</span>{sourceInput}<span className="math-source-delimiter" aria-hidden>{delimiter}</span></div>
      : <span {...sourceEditorProps}><span className="math-source-delimiter" aria-hidden>{delimiter}</span>{sourceInput}<span className="math-source-delimiter" aria-hidden>{delimiter}</span></span>
  }

  return <span
    aria-label={`${displayMode ? '块级' : '行内'}公式，点击编辑`}
    className={`math-node-rendered ${displayMode ? 'is-block' : 'is-inline'}${rendered.error ? ' has-error' : ''}`}
    onClick={(event) => {
      event.stopPropagation()
      setEditing(true)
    }}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setEditing(true)
      }
    }}
    role="button"
    onMouseDown={(event) => {
      event.preventDefault()
      event.stopPropagation()
    }}
    tabIndex={0}
    title={rendered.error ?? '点击编辑 LaTeX 源码'}
  >
    {rendered.html
      ? <span dangerouslySetInnerHTML={{ __html: rendered.html }} />
      : <><code>{displayMode ? `$$${value}$$` : `$${value}$`}</code><small>{rendered.error}</small></>}
  </span>
}

const mdastMathVisitor: MdastImportVisitor<InlineMath | MdastMath> = {
  testNode: (node): node is InlineMath | MdastMath => node.type === 'inlineMath' || node.type === 'math',
  visitNode({ actions, mdastNode }) {
    actions.addAndStepInto($createMathNode(mdastNode.value, mdastNode.type === 'math'))
  },
}

const lexicalMathVisitor: LexicalExportVisitor<MathNode, InlineMath | MdastMath> = {
  testLexicalNode: $isMathNode,
  visitLexicalNode({ actions, lexicalNode }) {
    actions.addAndStepInto(lexicalNode.getDisplayMode() ? 'math' : 'inlineMath', {
      value: lexicalNode.getValue(),
    }, false)
  },
}

function replaceInlineMathShortcut(node: TextNode): void {
  const text = node.getTextContent()
  const match = /(^|[^\\$])\$([^$\n]+?)\$(?!\$)/.exec(text)
  if (!match) return

  const start = match.index + match[1].length
  const length = match[0].length - match[1].length
  let formulaNode = node
  if (start > 0) formulaNode = node.splitText(start)[1]
  if (formulaNode.getTextContentSize() > length) formulaNode = formulaNode.splitText(length)[0]
  const mathNode = $createMathNode(match[2], false)
  formulaNode.replace(mathNode)
  const nextSibling = mathNode.getNextSibling()
  if ($isTextNode(nextSibling)) nextSibling.selectStart()
  else mathNode.selectNext()
}

function MathShortcutPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const handleBlockMathShortcut = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return
        const anchor = selection.anchor.getNode()
        if (!$isTextNode(anchor) || selection.anchor.offset !== anchor.getTextContentSize()) return
        const paragraph = anchor.getParent()
        if (!$isParagraphNode(paragraph) || paragraph.getChildrenSize() !== 1 || paragraph.getTextContent() !== '$$') return

        event.preventDefault()
        event.stopImmediatePropagation()
        const mathNode = $createMathNode('', true)
        const nextSibling = paragraph.getNextSibling()
        paragraph.replace(mathNode)
        if ($isElementNode(nextSibling)) nextSibling.selectStart()
        else {
          const nextParagraph = $createParagraphNode()
          mathNode.insertAfter(nextParagraph)
          nextParagraph.selectStart()
        }
      })
    }

    const removeRootListener = editor.registerRootListener((rootElement, previousRootElement) => {
      previousRootElement?.removeEventListener('keydown', handleBlockMathShortcut, true)
      rootElement?.addEventListener('keydown', handleBlockMathShortcut, true)
    })
    const removeTextTransform = editor.registerNodeTransform(TextNode, (node) => {
      const parent = node.getParent()
      if ($isParagraphNode(parent) && parent.getChildrenSize() === 1) {
        const blockMatch = /^\$\$([^\n]+)\$\$$/.exec(node.getTextContent())
        if (blockMatch) {
          const mathNode = $createMathNode(blockMatch[1], true)
          const nextSibling = parent.getNextSibling()
          parent.replace(mathNode)
          if ($isElementNode(nextSibling)) nextSibling.selectStart()
          else {
            const nextParagraph = $createParagraphNode()
            mathNode.insertAfter(nextParagraph)
            nextParagraph.selectStart()
          }
          return
        }
      }
      replaceInlineMathShortcut(node)
    })

    return () => {
      removeRootListener()
      removeTextTransform()
    }
  }, [editor])

  return null
}

export const mathEditorPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addSyntaxExtension$]: math({ singleDollarTextMath: true }),
      [addMdastExtension$]: mathFromMarkdown(),
      [addToMarkdownExtension$]: mathToMarkdown({ singleDollarTextMath: true }),
      [addImportVisitor$]: mdastMathVisitor,
      [addLexicalNode$]: MathNode,
      [addExportVisitor$]: lexicalMathVisitor,
      [addComposerChild$]: MathShortcutPlugin,
      [addNestedEditorChild$]: MathShortcutPlugin,
      [addTableCellEditorChild$]: MathShortcutPlugin,
    })
  },
})
