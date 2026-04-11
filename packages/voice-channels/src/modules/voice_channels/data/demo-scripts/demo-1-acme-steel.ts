import type { MockCallScript, MockScriptSegment } from '../../types'
import rawScript from './demo-1-acme-steel.json'

type RawSegment = (typeof rawScript)['segments'][number]

function normalizeSegment(raw: RawSegment): MockScriptSegment {
  return {
    segmentId: raw.segmentId,
    speaker: raw.speaker as MockScriptSegment['speaker'],
    text: raw.text,
    delayMs: raw.delayMs,
    expectedIntent:
      'expectedIntent' in raw && typeof raw.expectedIntent === 'string'
        ? (raw.expectedIntent as MockScriptSegment['expectedIntent'])
        : undefined,
  }
}

export const DEMO_1_ACME_STEEL: MockCallScript = {
  callId: rawScript.callId,
  phoneNumber: rawScript.phoneNumber,
  direction: rawScript.direction as MockCallScript['direction'],
  customerId: rawScript.customerId,
  customerName: rawScript.customerName,
  companyName: rawScript.companyName,
  language: rawScript.language,
  segments: rawScript.segments.map(normalizeSegment),
}
