export type SpaceStatus = 'draft' | 'published' | 'archived'
export type SpaceAccent = 'cyan' | 'violet' | 'amber' | 'blue'

export interface LearningSpace {
  id: string
  slug: string
  title: string
  description: string
  category: string
  tags: string[]
  cover?: string
  contentRoot: string
  entryDocument?: string
  status: SpaceStatus
  featured: boolean
  order: number
  accent?: SpaceAccent
  createdAt: string
  updatedAt: string
}

export interface SpaceCatalog {
  version: number
  spaces: LearningSpace[]
}

export interface DocumentMeta {
  id: string
  slug: string
  title: string
  summary: string
  status: SpaceStatus
  order: number
  tags: string[]
  estimatedMinutes?: number
  path: string
  format: 'markdown' | 'mdx' | 'html'
  updatedAt: string
}

export interface LearningDocument extends DocumentMeta {
  body: string
  revision: string
  headings: Array<{ depth: number; text: string; slug: string }>
}

export interface GitRevision {
  revision: string
  date: string
  subject: string
}

export interface SpaceSummary extends LearningSpace {
  documentCount: number
  completedCount?: number
}

export interface AnnotationTarget {
  blockId: string
  revision: string
  quote: {
    exact: string
    prefix: string
    suffix: string
  }
  position: {
    start: number
    end: number
  }
}

export type SelectionAssistantAction = 'translate' | 'ask-ai'

export interface SelectionAssistantRequest {
  action: SelectionAssistantAction
  documentId: string
  selection: AnnotationTarget
}

export interface SelectionAssistantResponse {
  status: 'not-configured'
  action: SelectionAssistantAction
  message: string
}

export interface Annotation {
  id: string
  spaceId: string
  documentId: string
  target: AnnotationTarget
  body: string
  color: 'cyan' | 'violet' | 'amber'
  status: 'active' | 'resolved' | 'orphaned'
  createdAt: string
  updatedAt: string
}

export interface ReadingProgress {
  spaceId: string
  documentId: string
  completed: boolean
  scrollPosition: number
  updatedAt: string
}

export interface SearchResult {
  spaceId: string
  spaceSlug: string
  spaceTitle: string
  category: string
  documentId: string
  documentSlug: string
  title: string
  summary: string
  excerpt: string
  tags: string[]
}
