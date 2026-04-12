export type QuantityMention = {
  value: number
  start: number
  end: number
}

// --- Polish word-form number maps ---

const PL_UNITS: Record<string, number> = {
  'zero': 0,
  'jeden': 1, 'jedna': 1, 'jedno': 1,
  'dwa': 2, 'dwie': 2, 'dwoje': 2,
  'trzy': 3, 'troje': 3,
  'cztery': 4, 'czworo': 4,
  'pięć': 5, 'piec': 5,
  'sześć': 6, 'szesc': 6,
  'siedem': 7,
  'osiem': 8,
  'dziewięć': 9, 'dziewiec': 9,
  'dziesięć': 10, 'dziesiec': 10,
  'jedenaście': 11, 'jedenascie': 11,
  'dwanaście': 12, 'dwanascie': 12,
  'trzynaście': 13, 'trzynascie': 13,
  'czternaście': 14, 'czternascie': 14,
  'piętnaście': 15, 'pietnascie': 15,
  'szesnaście': 16, 'szesnascie': 16,
  'siedemnaście': 17, 'siedemnascie': 17,
  'osiemnaście': 18, 'osiemnascie': 18,
  'dziewiętnaście': 19, 'dziewietnascie': 19,
}

const PL_TENS: Record<string, number> = {
  'dwadzieścia': 20, 'dwadziescia': 20,
  'trzydzieści': 30, 'trzydziesci': 30,
  'czterdzieści': 40, 'czterdziesci': 40,
  'pięćdziesiąt': 50, 'piecdziesiat': 50,
  'sześćdziesiąt': 60, 'szescdziesiat': 60,
  'siedemdziesiąt': 70, 'siedemdziesiat': 70,
  'osiemdziesiąt': 80, 'osiemdziesiat': 80,
  'dziewięćdziesiąt': 90, 'dziewiecdziesiat': 90,
}

const PL_HUNDREDS: Record<string, number> = {
  'sto': 100,
  'dwieście': 200, 'dwiescie': 200,
  'trzysta': 300,
  'czterysta': 400,
  'pięćset': 500, 'piecset': 500,
  'sześćset': 600, 'szescset': 600,
  'siedemset': 700,
  'osiemset': 800,
  'dziewięćset': 900, 'dziewiecset': 900,
}

const PL_THOUSANDS: Record<string, number> = {
  'tysiąc': 1000, 'tysiac': 1000,
  'tysiące': 1000, 'tysiace': 1000,
  'tysięcy': 1000, 'tysiecy': 1000,
}

const PL_HEDGES = new Set([
  'około', 'okolo', 'mniej', 'więcej', 'wiecej', 'chyba', 'ze', 'z',
  'jakieś', 'jakies', 'bodaj', 'prawie', 'ponad', 'blisko',
])

export const PL_STOPWORDS = new Set([
  'dzień', 'dobry', 'dzien', 'panie', 'pani', 'proszę', 'prosze',
  'dziękuję', 'dziekuje', 'dzwonię', 'dzwonie', 'dobrze', 'tak', 'nie',
  'bardzo', 'sprawie', 'państwa', 'panstwa', 'państwo', 'panstwo',
  'kwartał', 'kwartal', 'teraz', 'jak', 'co', 'czy', 'się', 'sie',
  'jest', 'być', 'byc', 'mamy', 'mam', 'masz', 'ma',
  'potrzebujemy', 'potrzebuję', 'potrzebuje', 'ale', 'bo',
  'doskonale', 'rozumiem', 'sprawdzam', 'sprawdzę', 'sprawdze',
  'przygotowuję', 'przygotowuje', 'świetnie', 'swietnie',
  'obawy', 'chwilę', 'chwile', 'później', 'pozniej',
  'ofertę', 'oferty', 'oferta', 'ofertą', 'akceptacji', 'akceptacja',
  'zamawiam', 'zamówienie', 'zamowienie', 'zamówienia', 'zamowienia',
  'ewa', 'jan', 'kowalski', 'janie', 'ewo', 'panie', 'janem',
  'open', 'mercato', 'pln', 'euro',
  'około', 'okolo', 'chyba', 'jeszcze', 'razie', 'takim', 'dobra',
  'procent', 'rabatu', 'promocja', 'promocje', 'cena', 'ceny',
  'godzin', 'godziny', 'certyfikację', 'certyfikacja',
])

const NON_QUANTITY_UNIT_PATTERN =
  /^\s*(?:%|procent(?:a|owy|owe|owego|owej|ów|y)?|proc(?:\.|ent)?|godz(?:\.|in[ay]?|ina|in)?|godzin(?:y|a|ach)?|minut(?:y|a|ach)?|sekund(?:y|a|ach)?|dni|dzień|tygodni(?:e|a|u)?|miesi[ąa]c(?:y|a|e|u)?|kwarta[lł](?:y|u|ów)?|rok(?:u|ów|i)?|lat(?:a|om)?|z[lł](?:otych|oty|ote)?|pln|eur|usd|m2|m³|cm|mm|m|kg|tys(?:\.|i[ąa]ce|i[ęa]cy|i[ąa]c)?|mln|mld)\b/i

const STEM_SUFFIXES = [
  'owych', 'owego', 'owej', 'owym', 'owymi',
  'ami', 'ach', 'ego', 'owa', 'owe', 'owy',
  'ych', 'ów', 'ow', 'om', 'ie', 'y', 'i', 'e', 'a',
]

export function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function expandStemVariants(token: string): string[] {
  const lowered = token.toLocaleLowerCase('pl-PL')
  const variants = [token]
  for (const suffix of STEM_SUFFIXES) {
    if (lowered.length > suffix.length + 2 && lowered.endsWith(suffix)) {
      variants.push(lowered.slice(0, -suffix.length))
      break
    }
  }
  return variants
}

function polishWordToken(token: string): number | null {
  const lowered = token.toLocaleLowerCase('pl-PL')
  const stripped = stripDiacritics(lowered)
  return (
    PL_HUNDREDS[lowered] ?? PL_HUNDREDS[stripped] ??
    PL_TENS[lowered] ?? PL_TENS[stripped] ??
    PL_UNITS[lowered] ?? PL_UNITS[stripped] ??
    PL_THOUSANDS[lowered] ?? PL_THOUSANDS[stripped] ??
    null
  )
}

function parsePolishNumberPhrase(
  tokens: string[],
  startIndex: number,
): { value: number; consumed: number } | null {
  let index = startIndex
  let total = 0
  let current = 0
  let consumed = 0

  while (index < tokens.length) {
    const token = tokens[index]
    if (!token) break

    if (PL_HEDGES.has(token.toLocaleLowerCase('pl-PL')) && consumed === 0) {
      index += 1
      continue
    }

    const numeric = polishWordToken(token)
    if (numeric == null) break

    const lowered = stripDiacritics(token.toLocaleLowerCase('pl-PL'))
    const isThousand = lowered === 'tysiac' || lowered === 'tysiace' || lowered === 'tysiecy'

    if (isThousand) {
      total += (current === 0 ? 1 : current) * 1000
      current = 0
    } else {
      current += numeric
    }

    consumed = index - startIndex + 1
    index += 1
  }

  const value = total + current
  if (value <= 0 || consumed === 0) return null
  return { value, consumed }
}

export function parsePolishWordNumber(text: string): number | null {
  if (typeof text !== 'string' || text.trim().length === 0) return null
  const tokens = text.trim().split(/\s+/)
  const result = parsePolishNumberPhrase(tokens, 0)
  return result?.value ?? null
}

export function hasNonQuantityUnitAfter(text: string, endIndex: number): boolean {
  const suffix = text.slice(endIndex, endIndex + 30)
  return NON_QUANTITY_UNIT_PATTERN.test(suffix)
}

function tokenizeForWordNumbers(text: string): Array<{ token: string; start: number; end: number }> {
  const tokens: Array<{ token: string; start: number; end: number }> = []
  const pattern = /[\p{L}]+/gu
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? -1
    if (start < 0) continue
    tokens.push({ token: match[0], start, end: start + match[0].length })
  }
  return tokens
}

export function collectWordNumberMentions(text: string): QuantityMention[] {
  const mentions: QuantityMention[] = []
  const tokens = tokenizeForWordNumbers(text)
  const words = tokens.map((entry) => entry.token)

  let index = 0
  while (index < tokens.length) {
    const parsed = parsePolishNumberPhrase(words, index)
    if (parsed && parsed.value > 0) {
      const firstToken = tokens[index]
      const lastToken = tokens[index + parsed.consumed - 1]
      if (firstToken && lastToken) {
        if (!hasNonQuantityUnitAfter(text, lastToken.end)) {
          mentions.push({ value: parsed.value, start: firstToken.start, end: lastToken.end })
        }
      }
      index += parsed.consumed
      continue
    }
    index += 1
  }

  return mentions
}

export function tokenizeAndFilterCustomerText(
  text: string,
  options?: { stopwords?: Set<string>; limit?: number },
): string[] {
  const stopwords = options?.stopwords ?? PL_STOPWORDS
  const limit = options?.limit ?? 40
  const pattern = /[\p{L}\p{N}][\p{L}\p{N}-]{1,}/gu
  const seen = new Set<string>()
  const results: string[] = []

  for (const match of text.matchAll(pattern)) {
    const token = match[0]?.trim()
    if (!token || token.length < 3) continue
    const lowered = token.toLocaleLowerCase('pl-PL')
    if (stopwords.has(lowered)) continue
    if (seen.has(lowered)) continue
    seen.add(lowered)

    for (const variant of expandStemVariants(token)) {
      if (!seen.has(variant.toLocaleLowerCase('pl-PL'))) {
        seen.add(variant.toLocaleLowerCase('pl-PL'))
        results.push(variant)
      }
    }
    if (results.length >= limit) break
  }

  return results
}
