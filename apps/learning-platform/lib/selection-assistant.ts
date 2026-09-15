import { z } from 'zod'

const annotationTargetSchema = z.object({
  blockId: z.string().min(1).max(160),
  revision: z.string().min(8).max(128),
  quote: z.object({
    exact: z.string().min(1).max(500),
    prefix: z.string().max(64),
    suffix: z.string().max(64),
  }),
  position: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  }),
}).refine((target) => target.position.end > target.position.start, '选区范围无效')

export const selectionAssistantRequestSchema = z.object({
  action: z.enum(['translate', 'ask-ai']),
  documentId: z.string().min(1).max(300),
  selection: annotationTargetSchema,
})
