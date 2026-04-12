import type { TranscriptSegment } from '../../types'
import {
  type QuantityMention,
  collectWordNumberMentions,
  hasNonQuantityUnitAfter,
} from '../text/polishText'

const QUANTITY_PATTERN = /(\d+(?:[.,]\d+)?)\s*(?:szt(?:\.|uk[ięa]?)?|pcs?|pieces?|units?|jednost(?:ek|ki|ka)?|opakowa(?:ń|nia|nie)?|palet(?:y|a)?)/i
const GLOBAL_QUANTITY_PATTERN = /(\d+(?:[.,]\d+)?)\s*(?:szt(?:\.|uk[ięa]?)?|pcs?|pieces?|units?|jednost(?:ek|ki|ka)?|opakowa(?:ń|nia|nie)?|palet(?:y|a)?)/giu
const GLOBAL_NUMBER_PATTERN = /(^|[^\p{L}\p{N}-])(\d+(?:[.,]\d+)?)(?=$|[^\p{L}\p{N}-])/giu
const SEARCH_TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}-]{1,}/gu

export function inferQuantityFromText(text: string): number | null {
  if (typeof text !== 'string' || text.trim().length === 0) return null

  const wordMentions = collectWordNumberMentions(text)
  if (wordMentions.length > 0) return wordMentions[0]!.value

  const explicitMatch = text.match(QUANTITY_PATTERN)
  if (explicitMatch?.[1]) {
    const value = Number(explicitMatch[1].replace(',', '.'))
    if (Number.isFinite(value) && value > 0) return value
  }

  for (const match of text.matchAll(GLOBAL_NUMBER_PATTERN)) {
    const raw = match[2]
    const start = match.index ?? -1
    if (!raw || start < 0) continue
    const offset = match[1]?.length ?? 0
    const quantityStart = start + offset
    const quantityEnd = quantityStart + raw.length
    if (hasNonQuantityUnitAfter(text, quantityEnd)) continue
    const value = Number(raw.replace(',', '.'))
    if (Number.isFinite(value) && value > 0) return value
  }

  return null
}

export function inferQuantityFromSegments(segments: TranscriptSegment[]): number | null {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const quantity = inferQuantityFromText(segments[index]?.text ?? '')
    if (quantity) return quantity
  }
  return null
}

function normalizeMatchText(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
}

function collectQuantityMentions(text: string): QuantityMention[] {
  const mentions: QuantityMention[] = []

  const wordMentions = collectWordNumberMentions(text)
  mentions.push(...wordMentions)

  for (const match of text.matchAll(GLOBAL_QUANTITY_PATTERN)) {
    const raw = match[1]
    const start = match.index ?? -1
    if (!raw || start < 0) continue
    const value = Number(raw.replace(',', '.'))
    if (!Number.isFinite(value) || value <= 0) continue
    mentions.push({ value, start, end: start + match[0].length })
  }

  for (const match of text.matchAll(GLOBAL_NUMBER_PATTERN)) {
    const raw = match[2]
    const start = match.index ?? -1
    if (!raw || start < 0) continue
    const value = Number(raw.replace(',', '.'))
    if (!Number.isFinite(value) || value <= 0) continue
    const offset = match[1]?.length ?? 0
    const quantityStart = start + offset
    const quantityEnd = quantityStart + raw.length
    if (hasNonQuantityUnitAfter(text, quantityEnd)) continue
    mentions.push({
      value,
      start: quantityStart,
      end: quantityEnd,
    })
  }

  return mentions
}

export function extractSearchKeywordsFromText(text: string, limit = 8): string[] {
  if (typeof text !== 'string' || text.trim().length === 0) return []

  const seen = new Set<string>()
  const results: string[] = []
  for (const match of text.matchAll(SEARCH_TOKEN_PATTERN)) {
    const token = match[0]?.trim()
    if (!token) continue
    const normalized = token.toLocaleLowerCase()
    const isNumeric = /^\d+(?:[.,]\d+)?$/.test(token)
    if (!isNumeric && normalized.length < 3) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    results.push(token)
    if (results.length >= limit) break
  }

  return results
}

export function extractQuantityNearAliases(text: string, aliases: string[]): number | null {
  if (typeof text !== 'string' || text.trim().length === 0) return null

  const normalizedText = normalizeMatchText(text)
  const normalizedAliases = Array.from(
    new Set(
      aliases
        .map((alias) => normalizeMatchText(alias))
        .filter((alias) => alias.length >= 2),
    ),
  )

  if (normalizedAliases.length === 0) return null

  const quantityMentions = collectQuantityMentions(normalizedText)
  if (quantityMentions.length === 0) return null

  let bestMatch: { value: number; distance: number } | null = null

  for (const alias of normalizedAliases) {
    let searchStart = 0
    while (searchStart < normalizedText.length) {
      const aliasIndex = normalizedText.indexOf(alias, searchStart)
      if (aliasIndex < 0) break

      const aliasEnd = aliasIndex + alias.length
      for (const quantity of quantityMentions) {
        const distance =
          quantity.end <= aliasIndex
            ? aliasIndex - quantity.end
            : quantity.start >= aliasEnd
              ? quantity.start - aliasEnd
              : 0

        if (distance > 32) continue
        if (!bestMatch || distance < bestMatch.distance) {
          bestMatch = { value: quantity.value, distance }
        }
      }

      searchStart = aliasEnd
    }
  }

  return bestMatch?.value ?? null
}

export function summarizeTranscriptSegments(
  segments: TranscriptSegment[],
  maxChars = 500,
): string {
  const summary = segments
    .slice(-8)
    .map((segment) => `[${segment.speaker}] ${segment.text.trim()}`)
    .filter((line) => line.length > 0)
    .join(' ')
    .trim()

  if (summary.length <= maxChars) return summary
  return `${summary.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}
