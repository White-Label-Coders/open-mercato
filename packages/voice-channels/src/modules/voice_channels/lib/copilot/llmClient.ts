export interface LlmClientConfig {
  provider: 'anthropic' | 'openai' | 'google'
  apiKey: string
  model?: string
  apiUrl?: string
  timeoutMs?: number
  maxRetries?: number
}

export interface LlmCompletionOptions {
  model?: string
  maxTokens?: number
  temperature?: number
}

export interface LlmClient {
  complete(
    systemPrompt: string,
    userPrompt: string,
    options?: LlmCompletionOptions,
  ): Promise<string | null>
}

const PROVIDER_DEFAULTS: Record<string, { model: string; apiUrl: string }> = {
  anthropic: {
    model: 'claude-haiku-4-5-20251001',
    apiUrl: 'https://api.anthropic.com/v1/messages',
  },
  openai: {
    model: 'gpt-4o-mini',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
  },
  google: {
    model: 'gemini-2.0-flash',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
}

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:\w*)\n?/i, '').replace(/\n?```\s*$/i, '').trim()
}

function buildAnthropicRequest(
  config: LlmClientConfig,
  systemPrompt: string,
  userPrompt: string,
  options?: LlmCompletionOptions,
): { url: string; init: RequestInit } {
  const model = options?.model ?? config.model ?? PROVIDER_DEFAULTS.anthropic.model
  const url = config.apiUrl ?? PROVIDER_DEFAULTS.anthropic.apiUrl
  return {
    url,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: options?.maxTokens ?? 800,
        temperature: options?.temperature ?? 0.2,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    },
  }
}

function extractAnthropicText(data: unknown): string | null {
  const record = data as Record<string, unknown> | null
  const content = Array.isArray(record?.content) ? record.content : []
  const text = (content[0] as Record<string, unknown> | undefined)?.text
  return typeof text === 'string' ? text : null
}

function buildOpenAIRequest(
  config: LlmClientConfig,
  systemPrompt: string,
  userPrompt: string,
  options?: LlmCompletionOptions,
): { url: string; init: RequestInit } {
  const model = options?.model ?? config.model ?? PROVIDER_DEFAULTS.openai.model
  const url = config.apiUrl ?? PROVIDER_DEFAULTS.openai.apiUrl
  return {
    url,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: options?.maxTokens ?? 800,
        temperature: options?.temperature ?? 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    },
  }
}

function extractOpenAIText(data: unknown): string | null {
  const record = data as Record<string, unknown> | null
  const choices = Array.isArray(record?.choices) ? record.choices : []
  const message = (choices[0] as Record<string, unknown> | undefined)?.message
  const content = (message as Record<string, unknown> | undefined)?.content
  return typeof content === 'string' ? content : null
}

function buildGoogleRequest(
  config: LlmClientConfig,
  systemPrompt: string,
  userPrompt: string,
  options?: LlmCompletionOptions,
): { url: string; init: RequestInit } {
  const model = options?.model ?? config.model ?? PROVIDER_DEFAULTS.google.model
  const baseUrl = config.apiUrl ?? PROVIDER_DEFAULTS.google.apiUrl
  const url = `${baseUrl}/models/${model}:generateContent?key=${config.apiKey}`
  return {
    url,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: options?.temperature ?? 0.2,
          maxOutputTokens: options?.maxTokens ?? 800,
        },
      }),
    },
  }
}

function extractGoogleText(data: unknown): string | null {
  const record = data as Record<string, unknown> | null
  const candidates = Array.isArray(record?.candidates) ? record.candidates : []
  const content = (candidates[0] as Record<string, unknown> | undefined)?.content
  const parts = (content as Record<string, unknown> | undefined)?.parts
  const text = Array.isArray(parts) ? (parts[0] as Record<string, unknown> | undefined)?.text : undefined
  return typeof text === 'string' ? text : null
}

type ProviderFns = {
  build: (config: LlmClientConfig, sys: string, user: string, opts?: LlmCompletionOptions) => { url: string; init: RequestInit }
  extract: (data: unknown) => string | null
}

const PROVIDERS: Record<string, ProviderFns> = {
  anthropic: { build: buildAnthropicRequest, extract: extractAnthropicText },
  openai: { build: buildOpenAIRequest, extract: extractOpenAIText },
  google: { build: buildGoogleRequest, extract: extractGoogleText },
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries: number,
  timeoutMs: number,
): Promise<Response | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const response = await fetch(url, { ...init, signal: controller.signal })
      clearTimeout(timer)

      if (response.ok) return response
      if (response.status < 500) return response

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        continue
      }
      return response
    } catch (err) {
      if (attempt >= maxRetries) {
        console.error('[llmClient] fetch error', err instanceof Error ? err.message : err)
        return null
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
  return null
}

export function createLlmClient(config: LlmClientConfig): LlmClient {
  const provider = PROVIDERS[config.provider]
  if (!provider) {
    throw new Error(`[llmClient] Unknown provider: ${config.provider}`)
  }

  const maxRetries = config.maxRetries ?? 1
  const timeoutMs = config.timeoutMs ?? 15000

  return {
    async complete(
      systemPrompt: string,
      userPrompt: string,
      options?: LlmCompletionOptions,
    ): Promise<string | null> {
      if (!config.apiKey) return null

      const { url, init } = provider.build(config, systemPrompt, userPrompt, options)
      const response = await fetchWithRetry(url, init, maxRetries, timeoutMs)

      if (!response) return null
      if (!response.ok) {
        console.error('[llmClient] HTTP error', { status: response.status, provider: config.provider })
        return null
      }

      const data = await response.json().catch(() => null)
      if (!data) return null

      const text = provider.extract(data)
      if (typeof text !== 'string') return null

      return stripCodeFences(text)
    },
  }
}
