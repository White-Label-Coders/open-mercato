import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { z } from 'zod'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['voice_channels.copilot.view'] },
}

export const openApi = {
  summary: 'Generate a conversation summary from transcript segments',
  tags: ['Voice Channels'],
}

const requestSchema = z.object({
  segments: z.array(
    z.object({
      speaker: z.string(),
      text: z.string(),
    }),
  ),
})

export async function POST(req: Request) {
  const { ctx } = await resolveRequestContext(req)
  if (!ctx.auth?.tenantId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let requestBody: unknown
  try {
    requestBody = await req.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(requestBody)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { segments } = parsed.data
  if (segments.length === 0) {
    return Response.json({ summary: '' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return Response.json({ summary: '', error: 'AI summarization unavailable' })
  }

  const transcript = segments
    .map((s) => `[${s.speaker}] ${s.text}`)
    .join('\n')
    .slice(0, 6000)

  const systemPrompt = `You are a CRM assistant. Given a sales call transcript, write a concise conversation summary (3-5 sentences) capturing:
- Key topics discussed
- Customer needs and concerns
- Commitments or promises made
- Agreed next steps

Rules:
- Write in the same language as the transcript (Polish if Polish, English if English).
- Be specific — reference actual topics, products, or numbers from the conversation.
- Keep summary under 600 characters.
- Return ONLY the summary text, no formatting, no headers.`

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
        max_tokens: 300,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: `TRANSCRIPT:\n${transcript}\n\nWrite the summary.` }],
      }),
    })

    if (!response.ok) {
      return Response.json({ summary: '', error: 'AI summarization failed' })
    }

    const data = await response.json()
    const text = data.content?.[0]?.text
    if (typeof text !== 'string') {
      return Response.json({ summary: '', error: 'AI returned empty response' })
    }

    const cleaned = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim()
    return Response.json({ summary: cleaned.slice(0, 600) })
  } catch {
    return Response.json({ summary: '', error: 'AI summarization failed' })
  }
}
