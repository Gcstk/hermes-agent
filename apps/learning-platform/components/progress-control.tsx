'use client'

import { Check, Circle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { ReadingProgress } from '@/lib/types'

export function ProgressControl({ spaceSlug, documentId }: { spaceSlug: string; documentId: string }) {
  const [progress, setProgress] = useState<ReadingProgress | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void fetch(`/api/spaces/${spaceSlug}/progress/${encodeURIComponent(documentId)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((value: ReadingProgress | null) => {
        setProgress(value)
        if (value && value.scrollPosition > 0.01 && !value.completed) {
          requestAnimationFrame(() => {
            const distance = (document.documentElement.scrollHeight - window.innerHeight) * value.scrollPosition
            window.scrollTo({ top: distance, behavior: 'instant' })
          })
        }
      })
    function recordPosition() {
      if (timer.current) return
      timer.current = setTimeout(() => {
        timer.current = null
        const maximum = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
        const scrollPosition = Math.min(1, window.scrollY / maximum)
        void fetch(`/api/spaces/${spaceSlug}/progress/${encodeURIComponent(documentId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scrollPosition }),
        })
      }, 1500)
    }
    window.addEventListener('scroll', recordPosition, { passive: true })
    return () => {
      window.removeEventListener('scroll', recordPosition)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [documentId, spaceSlug])

  async function toggleComplete() {
    const response = await fetch(`/api/spaces/${spaceSlug}/progress/${encodeURIComponent(documentId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: !progress?.completed }),
    })
    if (response.ok) setProgress(await response.json())
  }

  return (
    <button className={`complete-button ${progress?.completed ? 'is-complete' : ''}`} type="button" onClick={toggleComplete}>
      {progress?.completed ? <Check size={16} /> : <Circle size={16} />}
      {progress?.completed ? '已完成' : '标记完成'}
    </button>
  )
}
