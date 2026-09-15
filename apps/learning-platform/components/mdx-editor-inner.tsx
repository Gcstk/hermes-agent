'use client'

import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertTable,
  ListsToggle,
  MDXEditor,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  headingsPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
} from '@mdxeditor/editor'

import { mathEditorPlugin } from '@/components/math-editor-plugin'
import { markdownFocusPlugin } from '@/components/markdown-focus-plugin'

import '@mdxeditor/editor/style.css'

export function MdxEditorInner({
  markdown,
  onChange,
  initialView = 'rich-text',
  showToolbar = true,
  diffMarkdown = '',
  autoFocus = false,
  className,
  placeholder,
}: {
  markdown: string
  onChange: (markdown: string) => void
  initialView?: 'rich-text' | 'source' | 'diff'
  showToolbar?: boolean
  diffMarkdown?: string
  autoFocus?: boolean
  className?: string
  placeholder?: string
}) {
  return <MDXEditor
    markdown={markdown}
    onChange={onChange}
    autoFocus={autoFocus}
    className={className}
    placeholder={placeholder}
    contentEditableClassName="mdx-editable"
    plugins={[
      headingsPlugin(), listsPlugin(), quotePlugin(), thematicBreakPlugin(), linkPlugin(), tablePlugin(),
      markdownShortcutPlugin(), markdownFocusPlugin(), mathEditorPlugin(),
      codeBlockPlugin({ defaultCodeBlockLanguage: 'text' }),
      codeMirrorPlugin({ codeBlockLanguages: { text: 'Text', ts: 'TypeScript', tsx: 'TSX', python: 'Python', bash: 'Bash', mermaid: 'Mermaid', json: 'JSON', yaml: 'YAML' } }),
      diffSourcePlugin({ viewMode: initialView, diffMarkdown, readOnlyDiff: false }),
      ...(showToolbar ? [toolbarPlugin({ toolbarContents: () => <><UndoRedo /><BlockTypeSelect /><BoldItalicUnderlineToggles /><CodeToggle /><CreateLink /><ListsToggle /><InsertTable /><DiffSourceToggleWrapper options={['rich-text', 'source']} SourceToolbar={<span className="view-mode-label">Markdown 源码</span>}><span className="view-mode-label">即时渲染 · 聚焦显示源码</span></DiffSourceToggleWrapper></> })] : []),
    ]}
  />
}
