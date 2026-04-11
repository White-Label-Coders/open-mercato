import {
  extractQuantityNearAliases,
  extractSearchKeywordsFromText,
  inferQuantityFromSegments,
  inferQuantityFromText,
  summarizeTranscriptSegments,
} from '../quickActionDrafts'
import type { TranscriptSegment } from '../../../types'

describe('quickActionDrafts', () => {
  it('extracts quantity from explicit unit text', () => {
    expect(inferQuantityFromText('Potrzebujemy 40 sztuk rur stalowych')).toBe(40)
  })

  it('falls back to the latest segment with a quantity', () => {
    const segments: TranscriptSegment[] = [
      {
        segmentId: 1,
        speaker: 'customer',
        text: 'Interesują mnie rury stalowe',
        confidence: 0.9,
        isFinal: true,
        startTime: 0,
        endTime: 2,
      },
      {
        segmentId: 2,
        speaker: 'customer',
        text: 'Weźmiemy 12 sztuk na przyszły tydzień',
        confidence: 0.9,
        isFinal: true,
        startTime: 2,
        endTime: 4,
      },
    ]

    expect(inferQuantityFromSegments(segments)).toBe(12)
  })

  it('extracts per-product quantities from a shared sentence', () => {
    const text = 'Klient chce 123 sztuki Widget Alpha i 304 sztuki Widget Beta w tej samej ofercie.'

    expect(extractQuantityNearAliases(text, ['Widget Alpha'])).toBe(123)
    expect(extractQuantityNearAliases(text, ['Widget Beta'])).toBe(304)
  })

  it('does not treat sku digits as the ordered quantity', () => {
    const text = 'Poproszę produkt ABC-123 w ilości 8 sztuk.'

    expect(extractQuantityNearAliases(text, ['ABC-123'])).toBe(8)
  })

  it('extracts searchable keywords from transcript text', () => {
    expect(extractSearchKeywordsFromText('Potrzebuję 123 sztuk Widget Alpha na wtorek', 6)).toEqual([
      'Potrzebuję',
      '123',
      'sztuk',
      'Widget',
      'Alpha',
      'wtorek',
    ])
  })

  it('summarizes only the tail of the transcript', () => {
    const segments: TranscriptSegment[] = Array.from({ length: 10 }, (_, index) => ({
      segmentId: index + 1,
      speaker: index % 2 === 0 ? 'rep' : 'customer',
      text: `segment-${index + 1}`,
      confidence: 0.9,
      isFinal: true,
      startTime: index,
      endTime: index + 1,
    }))

    const summary = summarizeTranscriptSegments(segments, 400)
    expect(summary).toContain('segment-10')
    expect(summary).not.toContain('segment-2')
  })
})
