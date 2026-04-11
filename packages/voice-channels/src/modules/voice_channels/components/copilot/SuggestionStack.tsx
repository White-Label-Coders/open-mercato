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
  if (suggestions.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#94a3b8',
          fontSize: '15px',
          padding: '20px',
          textAlign: 'center',
        }}
      >
        {t(
          'voice_channels.copilot.suggestions.empty',
          'AI Copilot is listening and will suggest relevant products, pricing, and actions...',
        )}
      </div>
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px' }}>
      {suggestions.map((suggestion) => (
        <div
          key={suggestion.id}
          style={{
            marginBottom: '12px',
            animation: 'slideIn 0.4s ease-out',
          }}
        >
          {renderCard(suggestion, segments, onDismiss)}
        </div>
      ))}
    </div>
  )
}
