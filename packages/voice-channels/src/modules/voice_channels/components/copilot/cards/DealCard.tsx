'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DealStatusCard } from '../../../types'
import { CopilotCardFrame } from './CopilotCardFrame'

interface Props {
  card: DealStatusCard
  onDismiss: () => void
}

export function DealCard({ card, onDismiss }: Props) {
  const t = useT()
  return (
    <CopilotCardFrame
      tone="cyan"
      title={t('voice_channels.copilot.cards.dealStatus.title', 'Open deals')}
      icon="📊"
      onDismiss={onDismiss}
      dismissLabel={t('voice_channels.copilot.cards.dismiss.dealStatus', 'Dismiss deal status')}
    >
      <div className="space-y-3">
        {card.deals.map((deal) => (
          <div
            key={deal.id}
            className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 shadow-xs"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-semibold text-slate-100">{deal.title}</span>
              <span className="text-sm font-semibold text-emerald-300">
                {deal.value.toLocaleString()} {deal.currency}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 font-medium text-cyan-200">
                {deal.stage}
              </span>
              <span className="text-slate-400">
                {t('voice_channels.copilot.cards.dealStatus.daysInStage', '{days} days in stage', {
                  days: deal.daysInStage,
                })}
              </span>
              {deal.isStalled && (
                <span className="animate-pulse font-semibold text-rose-300">
                  ⚠ {t('voice_channels.copilot.cards.dealStatus.stalled', 'Stalled')}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </CopilotCardFrame>
  )
}
