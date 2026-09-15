'use client'

import { Maximize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

let mermaidInitialized = false

export function MermaidDiagram({ chart }: { chart: string }) {
  const diagramId = `diagram-${useId().replaceAll(':', '')}`
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    let cancelled = false
    async function renderDiagram() {
      try {
        const mermaid = (await import('mermaid')).default
        if (!mermaidInitialized) {
          mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' })
          mermaidInitialized = true
        }
        const { svg } = await mermaid.render(diagramId, chart)
        if (!cancelled && containerRef.current) containerRef.current.innerHTML = svg
      } catch (renderError) {
        if (!cancelled) setError(renderError instanceof Error ? renderError.message : '图表无法渲染')
      }
    }
    void renderDiagram()
    return () => { cancelled = true }
  }, [chart, diagramId])

  function fullscreen() {
    void containerRef.current?.parentElement?.requestFullscreen?.()
  }

  return (
    <figure className="mermaid-frame">
      <div className="diagram-toolbar" aria-label="图表控制">
        <button type="button" onClick={() => setScale((value) => Math.min(2, value + 0.15))} aria-label="放大图表"><ZoomIn size={16} /></button>
        <button type="button" onClick={() => setScale((value) => Math.max(0.55, value - 0.15))} aria-label="缩小图表"><ZoomOut size={16} /></button>
        <button type="button" onClick={() => setScale(1)} aria-label="重置缩放"><RotateCcw size={16} /></button>
        <button type="button" onClick={fullscreen} aria-label="全屏查看"><Maximize2 size={16} /></button>
      </div>
      {error ? <pre className="diagram-error">{chart}{'\n\n'}{error}</pre> : (
        <div className="mermaid-canvas" ref={containerRef} style={{ transform: `scale(${scale})` }} />
      )}
    </figure>
  )
}
