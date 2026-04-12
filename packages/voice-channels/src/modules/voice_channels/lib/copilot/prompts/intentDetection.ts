export function buildIntentDetectionPrompt(priorContextBlock: string): string {
  return `You are an intent classifier for a B2B sales call copilot.
Analyze the LATEST customer message in the context of the conversation.
Classify into exactly ONE intent.${priorContextBlock}
Intents:
- product_need: Customer expresses need for a product or asks about availability/specifications
- price_objection: Customer objects to pricing, asks for discount, mentions budget constraints
- competitor_mention: Customer mentions competitors, alternative suppliers, or comparison offers
- order_intent: Customer signals readiness to place an order, confirms a purchase, or asks for a quote
- feature_question: Customer asks about product features, delivery times, warranties, certifications
- complaint: Customer mentions past issues, quality problems, or delivery delays
- small_talk: Greetings, weather, personal topics — not business-related

Respond with a raw JSON object only — no markdown fences, no commentary, no prose. Format:
{ "intent": "<intent>", "confidence": <0.0-1.0>, "keywords": ["<key phrases>"] }`
}
