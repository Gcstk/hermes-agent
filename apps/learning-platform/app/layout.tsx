import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { SiteHeader } from '@/components/site-header'
import { WebMcpTools } from '@/components/webmcp-tools'

import 'katex/dist/katex.min.css'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: '学习图谱',
    template: '%s · 学习图谱',
  },
  description: '把 Agent Harness、推理系统与大模型课程组织成可持续维护的个人学习空间。',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="dark" suppressHydrationWarning>
      <body>
        <WebMcpTools />
        <SiteHeader />
        {children}
      </body>
    </html>
  )
}
