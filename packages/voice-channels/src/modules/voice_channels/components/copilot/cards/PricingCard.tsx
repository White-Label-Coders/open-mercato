'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { PricingAlertCard } from '../../../types'
import { CopilotAccentBadge, CopilotCardFrame } from './CopilotCardFrame'

interface Props {
  card: PricingAlertCard
  onDismiss: () => void
}

export function PricingCard({ card, onDismiss }: Props) {
  const t = useT()
  return (
    <CopilotCardFrame
      tone="amber"
      title={t('voice_channels.copilot.cards.pricing.title', 'Pricing alert')}
      icon="💰"
      triggerText={card.triggerText}
      badge={
        <CopilotAccentBadge tone="amber">
          {t('voice_channels.copilot.cards.pricing.match', '{confidence}% match', {
            confidence: card.matchConfidence,
          })}
        </CopilotAccentBadge>
      }
      onDismiss={onDismiss}
      dismissLabel={t('voice_channels.copilot.cards.dismiss.pricingAlert', 'Dismiss pricing alert')}
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 text-center">
            <div className="text-[11px] text-slate-400">
              {t('voice_channels.copilot.cards.pricing.customerPrice', 'Customer price')}
            </div>
            <div className="text-lg font-semibold text-slate-100">
              {card.currentPrice.toFixed(2)} {card.currency}
            </div>
          </div>
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-center">
            <div className="text-[11px] text-slate-400">
              {t('voice_channels.copilot.cards.pricing.floorPrice', 'Minimum price')}
            </div>
            <div className="text-lg font-semibold text-rose-200">
              {card.floorPrice.toFixed(2)} {card.currency}
            </div>
          </div>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
            <div className="text-[11px] text-slate-400">
              {t('voice_channels.copilot.cards.pricing.maxDiscount', 'Max discount')}
            </div>
            <div className="text-lg font-semibold text-emerald-200">
              {card.maxDiscountPercent}%
            </div>
          </div>
        </div>
        {card.activePromotions.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-semibold text-slate-200">
              {t('voice_channels.copilot.cards.pricing.activePromotions', 'Active promotions:')}
            </div>
            <div className="space-y-2">
              {card.activePromotions.map((promo, i) => (
                <div key={i} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                  <span className="font-semibold">🏷️ {promo.name}</span>: {promo.discount} (
                {t('voice_channels.copilot.cards.pricing.validUntil', 'until {date}', {
                  date: promo.validUntil,
                })}
                )
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </CopilotCardFrame>
  )
}
