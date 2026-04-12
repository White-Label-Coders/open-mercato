import {
  parsePolishWordNumber,
  expandStemVariants,
  hasNonQuantityUnitAfter,
  PL_STOPWORDS,
} from '../polishText'

describe('parsePolishWordNumber', () => {
  it('parses simple hundreds', () => {
    expect(parsePolishWordNumber('pięćset')).toBe(500)
    expect(parsePolishWordNumber('dwieście')).toBe(200)
    expect(parsePolishWordNumber('sto')).toBe(100)
    expect(parsePolishWordNumber('trzysta')).toBe(300)
  })

  it('parses compound numbers', () => {
    expect(parsePolishWordNumber('sto dwadzieścia')).toBe(120)
    expect(parsePolishWordNumber('dwieście pięćdziesiąt')).toBe(250)
  })

  it('parses thousands', () => {
    expect(parsePolishWordNumber('tysiąc')).toBe(1000)
    expect(parsePolishWordNumber('dwa tysiące')).toBe(2000)
    expect(parsePolishWordNumber('dwa tysiące pięćset')).toBe(2500)
  })

  it('absorbs hedging words', () => {
    expect(parsePolishWordNumber('około pięćset')).toBe(500)
    expect(parsePolishWordNumber('chyba z dwieście')).toBe(200)
  })

  it('returns null for non-numbers', () => {
    expect(parsePolishWordNumber('Dzień')).toBeNull()
    expect(parsePolishWordNumber('rury')).toBeNull()
    expect(parsePolishWordNumber('')).toBeNull()
  })

  it('handles diacriticless input', () => {
    expect(parsePolishWordNumber('piecset')).toBe(500)
    expect(parsePolishWordNumber('dwiescie')).toBe(200)
  })
})

describe('expandStemVariants', () => {
  it('strips Polish inflection suffixes', () => {
    expect(expandStemVariants('zaworów')).toContain('zawor')
    expect(expandStemVariants('kulowych')).toContain('kul')
    expect(expandStemVariants('stalowych')).toContain('stal')
  })

  it('keeps original token', () => {
    expect(expandStemVariants('zaworów')).toContain('zaworów')
  })

  it('does not strip short tokens', () => {
    const result = expandStemVariants('DN50')
    expect(result).toEqual(['DN50'])
  })
})

describe('hasNonQuantityUnitAfter', () => {
  it('returns true for time units', () => {
    expect(hasNonQuantityUnitAfter('wysyłka w 48 godzin', 12)).toBe(true)
  })

  it('returns true for percentages', () => {
    expect(hasNonQuantityUnitAfter('12 procent rabatu', 2)).toBe(true)
    expect(hasNonQuantityUnitAfter('daje 10 procent taniej', 7)).toBe(true)
  })

  it('returns true for money', () => {
    expect(hasNonQuantityUnitAfter('20 tysięcy złotych', 2)).toBe(true)
  })

  it('returns false for quantity units', () => {
    expect(hasNonQuantityUnitAfter('500 sztuk', 3)).toBe(false)
  })

  it('returns false for product words', () => {
    expect(hasNonQuantityUnitAfter('500 rur stalowych', 3)).toBe(false)
  })
})

describe('PL_STOPWORDS', () => {
  it('contains common filler words', () => {
    expect(PL_STOPWORDS.has('dzień')).toBe(true)
    expect(PL_STOPWORDS.has('dobry')).toBe(true)
    expect(PL_STOPWORDS.has('zamawiam')).toBe(true)
  })

  it('does not contain product words', () => {
    expect(PL_STOPWORDS.has('rura')).toBe(false)
    expect(PL_STOPWORDS.has('zawór')).toBe(false)
    expect(PL_STOPWORDS.has('dn50')).toBe(false)
  })
})
