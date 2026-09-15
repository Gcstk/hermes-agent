'use client'

import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

export function ThemeToggle() {
  const [dark, setDark] = useState(true)

  useEffect(() => {
    const stored = window.localStorage.getItem('learning-theme')
    const nextDark = stored ? stored === 'dark' : true
    setDark(nextDark)
    document.documentElement.dataset.theme = nextDark ? 'dark' : 'light'
  }, [])

  function toggleTheme() {
    const nextDark = !dark
    setDark(nextDark)
    document.documentElement.dataset.theme = nextDark ? 'dark' : 'light'
    window.localStorage.setItem('learning-theme', nextDark ? 'dark' : 'light')
  }

  return (
    <button className="icon-button" type="button" onClick={toggleTheme} aria-label="切换明暗主题">
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}
