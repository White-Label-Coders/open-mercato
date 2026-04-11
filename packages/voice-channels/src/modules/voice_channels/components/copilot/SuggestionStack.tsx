'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { SuggestionCard, TranscriptSegment } from '../../types'
import { ProductCard } from './cards/ProductCard'
import { PricingCard } from './cards/PricingCard'
import { ContextCard } from './cards/ContextCard'
import { DealCard } from './cards/DealCard'
import { ActionCard } from './cards/ActionCard'

interface SuggestionStackProps {
  suggestions: SuggestionCard[]
  segments: TranscriptSegment[]
  onDismiss: (id: string) => void
}

function renderCard(card: SuggestionCard, segments: TranscriptSegment[], onDismiss: (id: string) => void) {
  switch (card.type) {
    case 'product_suggestion':
      return <ProductCard card={card} onDismiss={() => onDismiss(card.id)} />
    case 'pricing_alert':
      return <PricingCard card={card} onDismiss={() => onDismiss(card.id)} />
    case 'customer_context':
      return <ContextCard card={card} onDismiss={() => onDismiss(card.id)} />
    case 'deal_status':
      return <DealCard card={card} onDismiss={() => onDismiss(card.id)} />
    case 'quick_action':
      return <ActionCard card={card} segments={segments} onDismiss={() => onDismiss(card.id)} />
    default:
      return null
  }
}

export function SuggestionStack({ suggestions, segments, onDismiss }: SuggestionStackProps) {
  const t = useT()

  const pinnedQuickActions = suggestions.filter((suggestion) => suggestion.type === 'quick_action')
  const regularSuggestions = suggestions.filter((suggestion) => suggestion.type !== 'quick_action')

  if (suggestions.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-5 text-center text-[15px] text-slate-400">
        {t(
          'voice_channels.copilot.suggestions.empty',
          'AI Copilot is listening and will suggest relevant products, pricing, and actions...',
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      {pinnedQuickActions.length > 0 ? (
        <div className="sticky top-0 z-10 -mx-4 mb-3 bg-muted/30 px-4 pb-3 pt-0 backdrop-blur-sm">
          {pinnedQuickActions.map((suggestion) => (
            <div key={suggestion.id} className="animate-[slideIn_0.4s_ease-out]">
              {renderCard(suggestion, segments, onDismiss)}
            </div>
          ))}
        </div>
      ) : null}
      {regularSuggestions.map((suggestion) => (
        <div key={suggestion.id} className="mb-3 animate-[slideIn_0.4s_ease-out] last:mb-0">
          {renderCard(suggestion, segments, onDismiss)}
        </div>
      ))}
    </div>
  )
}
