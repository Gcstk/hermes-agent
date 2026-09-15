'use client'

import { Check, Columns2, Eye, GitCompareArrows, GitCommitHorizontal, PencilLine, Save } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { MarkdownContent } from '@/components/markdown-content'
import type { GitRevision } from '@/lib/types'

const MdxEditor = dynamic(() => import('@/components/mdx-editor-inner').then((module) => module.MdxEditorInner), { ssr: false })

type EditorView = 'visual' | 'split' | 'compare' | 'preview'

export function AdminDocumentEditor({
  spaceId,
  spaceSlug,
  documentId,
  title,
  sourcePath,
  initialSource,
  initialRevision,
  savedDraft,
  format,
  revisions,
}: {
  spaceId: string
  spaceSlug: string
  documentId: string
  title: string
  sourcePath: string
  initialSource: string
  initialRevision: string
  format: 'markdown' | 'mdx' | 'html'
  revisions: GitRevision[]
  savedDraft?: { source: string; baseRevision: string }
}) {
  const router = useRouter()
  const [source, setSource] = useState(savedDraft?.source ?? initialSource)
  const [baseRevision, setBaseRevision] = useState(savedDraft?.baseRevision ?? initialRevision)
  const [view, setView] = useState<EditorView>('visual')
  const [message, setMessage] = useState(savedDraft ? '已恢复未发布草稿' : '')
  const [pending, setPending] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [comparisonRevision, setComparisonRevision] = useState('current-file')
  const [comparisonSource, setComparisonSource] = useState(initialSource)
  const [comparisonLoading, setComparisonLoading] = useState(false)
  const [comparisonError, setComparisonError] = useState('')
  const sourceLabel = format === 'html' ? 'HTML 源码' : format === 'mdx' ? 'MDX 源码' : 'Markdown 源码'

  useEffect(() => {
    if (!dirty) return
    const timer = setTimeout(() => { void saveDraft(true) }, 4000)
    return () => clearTimeout(timer)
  }, [source, dirty])

  async function saveDraft(silent = false): Promise<boolean> {
    setPending(true)
    const response = await fetch(`/api/admin/spaces/${spaceId}/documents/draft`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId, source, baseRevision, format }),
    })
    const payload = await response.json()
    setPending(false)
    if (!response.ok) { setMessage(payload.error ?? '草稿保存失败'); return false }
    setDirty(false)
    if (!silent) setMessage('草稿已保存，不会修改 Git')
    return true
  }

  async function publish() {
    if (!await saveDraft(true)) return
    const commitMessage = window.prompt('填写本次发布的 Git 提交说明', `docs(learning): update ${title}`)
    if (!commitMessage) return
    setPending(true)
    const response = await fetch(`/api/admin/spaces/${spaceId}/documents/publish`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId, commitMessage }),
    })
    const payload = await response.json()
    setPending(false)
    if (!response.ok) { setMessage(payload.error ?? '发布失败'); return }
    setBaseRevision(payload.documentRevision)
    setMessage(`已发布为提交 ${String(payload.revision).slice(0, 8)}`)
    router.refresh()
  }

  function updateSource(value: string): void {
    setSource(value)
    setDirty(value !== (savedDraft?.source ?? initialSource))
  }

  async function selectComparisonRevision(revision: string): Promise<void> {
    setComparisonRevision(revision)
    setComparisonError('')
    if (revision === 'current-file') {
      setComparisonSource(initialSource)
      return
    }
    setComparisonLoading(true)
    const query = new URLSearchParams({ document: documentId, revision })
    const response = await fetch(`/api/admin/spaces/${spaceId}/documents/history?${query}`)
    const payload = await response.json()
    setComparisonLoading(false)
    if (!response.ok) {
      setComparisonError(payload.error ?? '读取历史版本失败')
      return
    }
    setComparisonSource(String(payload.source))
  }

  return <div className="editor-workspace">
    <header className="editor-toolbar"><div><strong>{title}</strong><span>{dirty ? '有未保存修改' : '草稿已同步'}</span></div><div><div className="editor-view-switch" role="group" aria-label="编辑器视图"><button className={view === 'visual' ? 'is-active' : ''} type="button" aria-pressed={view === 'visual'} onClick={() => setView('visual')}><PencilLine size={15} />富文本编辑</button><button className={view === 'split' ? 'is-active' : ''} type="button" aria-pressed={view === 'split'} onClick={() => setView('split')}><Columns2 size={15} />源码与预览</button><button className={view === 'compare' ? 'is-active' : ''} type="button" aria-pressed={view === 'compare'} onClick={() => setView('compare')}><GitCompareArrows size={15} />Git 版本对比</button><button className={view === 'preview' ? 'is-active' : ''} type="button" aria-pressed={view === 'preview'} onClick={() => setView('preview')}><Eye size={15} />阅读预览</button></div><button type="button" disabled={pending || !dirty} onClick={() => void saveDraft()}><Save size={16} />保存草稿</button><button className="primary-button" type="button" disabled={pending} onClick={() => void publish()}><GitCommitHorizontal size={16} />发布到 Git</button></div></header>
    {message && <p className="editor-message"><Check size={15} />{message}</p>}
    {view === 'preview' ? (
      <article className="editor-preview prose"><MarkdownContent body={source} sourcePath={sourcePath} spaceSlug={spaceSlug} /></article>
    ) : view === 'split' ? (
      <div className="editor-split-view">
        <section className="editor-split-pane editor-source-pane">
          <header className="editor-pane-heading"><strong>{sourceLabel}</strong><span>可编辑</span></header>
          <div className="editor-source-host"><MdxEditor markdown={source} initialView="source" showToolbar={false} onChange={updateSource} /></div>
        </section>
        <section className="editor-split-pane editor-preview-pane">
          <header className="editor-pane-heading"><strong>实时预览</strong><span>跟随左侧内容更新</span></header>
          <article className="editor-split-preview prose"><MarkdownContent body={source} sourcePath={sourcePath} spaceSlug={spaceSlug} /></article>
        </section>
      </div>
    ) : view === 'compare' ? (
      <div className="editor-compare-view">
        <header className="editor-compare-toolbar">
          <label><span>选择左侧基准版本</span><select value={comparisonRevision} disabled={comparisonLoading} onChange={(event) => void selectComparisonRevision(event.target.value)}><option value="current-file">当前文件（发布基线）</option>{revisions.map((revision) => <option value={revision.revision} key={revision.revision}>{revision.revision.slice(0, 8)} · {revision.date.slice(0, 10)} · {revision.subject}</option>)}</select></label>
          <div className="editor-compare-legend"><span><i className="baseline" />左侧：基准版本，只读</span><span><i className="draft" />右侧：当前草稿，可编辑</span></div>
        </header>
        {revisions.length === 0 && <p className="editor-history-hint">这篇文章还没有 Git 历史提交。当前仍可对比磁盘中的发布基线与草稿；首次发布后，下拉框会出现具体提交。</p>}
        {comparisonLoading ? <div className="editor-compare-state">正在读取 Git 历史版本…</div> : comparisonError ? <div className="editor-compare-state is-error">{comparisonError}</div> : <div className="editor-version-diff"><div className="editor-diff-headings"><div><strong>{comparisonRevision === 'current-file' ? '当前文件（发布基线）' : `Git ${comparisonRevision.slice(0, 8)}`}</strong><span>只读</span></div><div><strong>当前草稿</strong><span>可编辑，修改会进入自动保存</span></div></div><MdxEditor key={comparisonRevision} markdown={source} diffMarkdown={comparisonSource} initialView="diff" showToolbar={false} onChange={updateSource} /></div>}
      </div>
    ) : (
      <MdxEditor markdown={source} onChange={updateSource} />
    )}
  </div>
}
