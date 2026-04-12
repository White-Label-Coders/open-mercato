import type { TranscriptSegment } from '@open-mercato/voice-channels/modules/voice_channels/types'

export interface FollowUpPrefill {
  customerId: string | null
  targetEntityId: string | null
  targetEntityIds: string[]
  callId: string
  ownerUserId?: string | null
  title: string
  description: string
  suggestedDate: string
}

export interface NotePrefill {
  customerId: string | null
  targetEntityIds: string[]
  callId: string
  summary: string
}

export interface QuickActionPrefillResult {
  followUp: FollowUpPrefill
  note: NotePrefill
}

interface GeneratePrefillInput {
  callId: string
  customerId: string | null
  targetEntityId: string | null
  ownerUserId?: string | null
  contextWindow: TranscriptSegment[]
  detectedIntents: string[]
}

function resolveTargetEntityIds(input: Pick<GeneratePrefillInput, 'customerId' | 'targetEntityId'>): string[] {
  if (typeof input.targetEntityId === 'string' && input.targetEntityId.length > 0) {
    return Array.from(
      new Set(
        [input.customerId, input.targetEntityId].filter(
          (value): value is string => typeof value === 'string' && value.length > 0,
        ),
      ),
    )
  }

  return Array.from(
    new Set(
      [input.customerId].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      ),
    ),
  )
}

function buildTranscriptText(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => `[${s.speaker}] ${s.text}`)
    .join('\n')
    .slice(0, 6000)
}

function getNextBusinessDayMorning(): string {
  const now = new Date()
  const next = new Date(now)
  next.setDate(next.getDate() + 1)
  // Skip Saturday (6) and Sunday (0)
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1)
  }
  next.setHours(9, 0, 0, 0)
  return next.toISOString()
}

function buildFallbackPrefill(input: GeneratePrefillInput): QuickActionPrefillResult {
  const transcriptExcerpt = buildTranscriptText(input.contextWindow).slice(0, 500)
  const targetEntityIds = resolveTargetEntityIds(input)

  return {
    followUp: {
      customerId: input.customerId,
      targetEntityId: input.targetEntityId,
      targetEntityIds,
      callId: input.callId,
      ownerUserId: input.ownerUserId ?? null,
      title: '',
      description: '',
      suggestedDate: getNextBusinessDayMorning(),
    },
    note: {
      customerId: input.customerId,
      targetEntityIds,
      callId: input.callId,
      summary: transcriptExcerpt,
    },
  }
}

export async function generateQuickActionPrefill(
  input: GeneratePrefillInput,
): Promise<QuickActionPrefillResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('[generateQuickActionPrefill] No ANTHROPIC_API_KEY — using fallback')
    return buildFallbackPrefill(input)
  }

  if (input.contextWindow.length === 0) {
    return buildFallbackPrefill(input)
  }

  const transcriptText = buildTranscriptText(input.contextWindow)
  const intentSummary = input.detectedIntents.join(', ') || '(none detected)'

  const systemPrompt = `You are a CRM assistant. Given a sales call transcript, produce a JSON object with two keys:

1. "summary" — a concise conversation summary (2-4 sentences) capturing: key topics discussed, customer needs, commitments made, and next steps mentioned. Write in the same language as the transcript.

2. "followUp" — a suggested follow-up action with:
   - "title": short action title (e.g. "Follow-up: discuss pricing proposal")
   - "description": 1-2 sentence description of what the rep should do

Rules:
- Return ONLY valid JSON, no markdown fences, no commentary.
- Write in the language of the transcript (Polish if Polish, English if English).
- Be specific — reference actual topics, products, or numbers from the conversation.
- Keep summary under 500 characters and description under 300 characters.`

  const userPrompt = `DETECTED INTENTS: ${intentSummary}

TRANSCRIPT:
${transcriptText}

Return JSON: { "summary": "...", "followUp": { "title": "...", "description": "..." } }`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!response.ok) {
      console.error('[generateQuickActionPrefill] API error:', response.status)
      return buildFallbackPrefill(input)
    }

    const data = await response.json()
    const text = data.content?.[0]?.text
    if (typeof text !== 'string') {
      return buildFallbackPrefill(input)
    }

    const cleaned = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim()
    const parsed = JSON.parse(cleaned)

    const summary = typeof parsed.summary === 'string' ? parsed.summary.slice(0, 500) : ''
    const followUpTitle = typeof parsed.followUp?.title === 'string' ? parsed.followUp.title.slice(0, 200) : ''
    const followUpDescription = typeof parsed.followUp?.description === 'string' ? parsed.followUp.description.slice(0, 300) : ''
    const targetEntityIds = resolveTargetEntityIds(input)

    return {
      followUp: {
        customerId: input.customerId,
        targetEntityId: input.targetEntityId,
        targetEntityIds,
        callId: input.callId,
        ownerUserId: input.ownerUserId ?? null,
        title: followUpTitle,
        description: followUpDescription,
        suggestedDate: getNextBusinessDayMorning(),
      },
      note: {
        customerId: input.customerId,
        targetEntityIds,
        callId: input.callId,
        summary: summary || buildTranscriptText(input.contextWindow).slice(0, 500),
      },
    }
  } catch (err) {
    console.error('[generateQuickActionPrefill] Failed:', err)
    return buildFallbackPrefill(input)
  }
}
