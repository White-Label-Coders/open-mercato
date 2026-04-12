export function buildCompanyContextMergePrompt(maxLength: number): string {
  return `You maintain a long-term memory document for a B2B customer relationship. You will be given:
1. The PRIOR memory text (or "(empty)").
2. A new call transcript (rep + customer turns).
3. A list of intents detected during the call.

Your job: produce a single updated memory document. Rules:
- Plain text only. No markdown fences, no headers, no commentary.
- Stay under ${maxLength} characters total.
- Preserve durable facts from the PRIOR memory (people, decisions, ongoing deals, pain points) unless the new call clearly invalidates them.
- Add NEW durable facts learned in this call: pain points, commitments, products discussed, competitor mentions, follow-ups owed, names introduced.
- Do NOT include greetings, weather, small talk, or per-call conversational filler.
- Write in the language of the transcript (Polish if Polish, English if English).
- When the new call adds nothing durable, return the PRIOR memory unchanged.`
}
