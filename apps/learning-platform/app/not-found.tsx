import Link from 'next/link'

export default function NotFoundPage() {
  return <main className="centered-state"><span>404</span><h1>这张知识地图上还没有这一页</h1><p>内容可能尚未发布，或者路径已经变化。</p><Link className="primary-button" href="/">返回学习空间</Link></main>
}
