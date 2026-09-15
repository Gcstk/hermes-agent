import type { AnnotationTarget } from '@/lib/types'

export interface ResolvedTextAnchor {
  start: number
  end: number
  strategy: 'position' | 'quote'
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let matched = 0
  while (matched < limit && left[matched] === right[matched]) matched += 1
  return matched
}

function commonSuffixLength(left: string, right: string): number {
  return commonPrefixLength([...left].reverse().join(''), [...right].reverse().join(''))
}

export function resolveTextAnchor(text: string, target: AnnotationTarget): ResolvedTextAnchor | null {
  const exact = target.quote.exact
  if (!exact) return null
  const { start, end } = target.position
  if (start >= 0 && end >= start && text.slice(start, end) === exact) {
    return { start, end, strategy: 'position' }
  }

  const candidates: Array<{ start: number; score: number }> = []
  let offset = text.indexOf(exact)
  while (offset >= 0) {
    const before = text.slice(Math.max(0, offset - target.quote.prefix.length), offset)
    const after = text.slice(offset + exact.length, offset + exact.length + target.quote.suffix.length)
    candidates.push({
      start: offset,
      score: commonSuffixLength(before, target.quote.prefix) + commonPrefixLength(after, target.quote.suffix),
    })
    offset = text.indexOf(exact, offset + 1)
  }
  if (candidates.length === 0) return null
  candidates.sort((left, right) => right.score - left.score)
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) return null
  return { start: candidates[0].start, end: candidates[0].start + exact.length, strategy: 'quote' }
}
