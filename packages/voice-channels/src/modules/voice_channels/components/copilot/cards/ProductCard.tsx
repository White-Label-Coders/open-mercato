'use client'

import { useState } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import type { ProductSuggestionCard } from '../../../types'
import { CopilotAccentBadge, CopilotCardFrame } from './CopilotCardFrame'

interface Props {
  card: ProductSuggestionCard
  onDismiss: () => void
}

export function ProductCard({ card, onDismiss }: Props) {
  const t = useT()
  const [addedProductIds, setAddedProductIds] = useState<Set<string>>(new Set())

  return (
    <CopilotCardFrame
      tone="blue"
      title={t('voice_channels.copilot.cards.product.title', 'Product suggestion')}
      icon="📦"
      triggerText={card.triggerText}
      badge={
        <CopilotAccentBadge tone={card.matchConfidence >= 80 ? 'emerald' : 'amber'}>
          {t('voice_channels.copilot.cards.pricing.match', '{confidence}% match', {
            confidence: card.matchConfidence,
          })}
        </CopilotAccentBadge>
      }
      onDismiss={onDismiss}
      dismissLabel={t('voice_channels.copilot.cards.dismiss.productSuggestion', 'Dismiss product suggestion')}
    >
      <div className="space-y-3">
        {card.products.map((product) => (
          <div
            key={product.id}
            className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 shadow-xs"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">{product.name}</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {t('voice_channels.copilot.cards.product.sku', 'SKU: {sku}', { sku: product.sku })}
                </div>
              </div>
              <div className="text-right">
                <div className="text-base font-semibold text-emerald-300">
                  {product.price.amount.toFixed(2)} {product.price.currency}
                </div>
                <div className="text-[11px] text-slate-500">{product.price.priceType}</div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span
                className={cn(
                  'text-xs font-medium',
                  product.available ? 'text-emerald-300' : 'text-rose-300',
                )}
              >
                {product.available
                  ? `✓ ${t('voice_channels.copilot.cards.product.inStock', 'In stock{quantityPart}', {
                      quantityPart: product.stockQuantity
                        ? t(
                            'voice_channels.copilot.cards.product.inStockQuantity',
                            ' ({quantity} pcs.)',
                            { quantity: product.stockQuantity },
                          )
                        : '',
                    })}`
                  : `✗ ${t('voice_channels.copilot.cards.product.outOfStock', 'Out of stock')}`}
              </span>
              <Button
                type="button"
                onClick={() => {
                  setAddedProductIds((prev) => new Set(prev).add(product.id))
                }}
                disabled={addedProductIds.has(product.id)}
                variant="outline"
                size="sm"
                className={
                  addedProductIds.has(product.id)
                    ? 'h-auto border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 hover:text-emerald-200'
                    : 'h-auto border-blue-500/40 bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-200 hover:bg-blue-500/25 hover:text-blue-200'
                }
              >
                {addedProductIds.has(product.id)
                  ? `✓ ${t('voice_channels.copilot.cards.product.addedToOffer', 'Added to offer')}`
                  : `+ ${t('voice_channels.copilot.cards.product.addToOffer', 'Add to offer')}`}
              </Button>
            </div>
            {product.matchReason && (
              <div className="mt-2 text-[11px] text-slate-500">
                {product.matchReason}
              </div>
            )}
          </div>
        ))}
      </div>
    </CopilotCardFrame>
  )
}
