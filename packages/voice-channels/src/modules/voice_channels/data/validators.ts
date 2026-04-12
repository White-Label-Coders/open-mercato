import { z } from 'zod'

export const quoteLlmLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().optional(),
})

export const quoteLlmResponseSchema = z.object({
  lines: z.array(quoteLlmLineSchema),
})

export type QuoteLlmResponse = z.infer<typeof quoteLlmResponseSchema>
