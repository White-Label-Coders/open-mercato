'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CustomerContextCard } from '../../../types'
import { CopilotCardFrame } from './CopilotCardFrame'

interface Props {
  card: CustomerContextCard
  onDismiss: () => void
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-100">{value}</div>
    </div>
  )
}

export function ContextCard({ card, onDismiss }: Props) {
  const t = useT()
  const c = card.customer

  return (
    <CopilotCardFrame
      tone="violet"
      title={t('voice_channels.copilot.cards.customerContext.title', 'Customer context')}
      icon="👤"
      onDismiss={onDismiss}
      dismissLabel={t('voice_channels.copilot.cards.dismiss.customerContext', 'Dismiss customer context')}
    >
      <div className="space-y-4">
        <div>
          <div className="text-base font-semibold text-slate-100">{c.name}</div>
          <div className="text-sm text-slate-400">{c.company}</div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <StatBox label={t('voice_channels.copilot.cards.customerContext.ltv', 'Customer value (LTV)')} value={`${c.lifetimeValue.toLocaleString()} ${c.currency}`} />
          <StatBox label={t('voice_channels.copilot.cards.customerContext.lastOrder', 'Last order')} value={c.lastOrderDate} />
          <StatBox label={t('voice_channels.copilot.cards.customerContext.orderCount', 'Order count')} value={String(c.orderCount)} />
          <StatBox label={t('voice_channels.copilot.cards.customerContext.averageOrderValue', 'Avg. order value')} value={`${c.avgOrderValue.toLocaleString()} ${c.currency}`} />
        </div>

        {c.topCategories.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] text-slate-400">
              {t('voice_channels.copilot.cards.customerContext.topCategories', 'Top categories:')}
            </div>
            <div className="flex flex-wrap gap-2">
              {c.topCategories.map((cat, i) => (
                <span key={i} className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[11px] text-slate-200">
                  {cat}
                </span>
              ))}
            </div>
          </div>
        )}

        {c.notes && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            📝 {c.notes}
          </div>
        )}

        {card.priorContext && (
          <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-3">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-violet-300">
              🧠 Pamięć Copilota
            </div>
            <div className="whitespace-pre-wrap text-xs leading-5 text-violet-100">
              {card.priorContext}
            </div>
          </div>
        )}
      </div>
    </CopilotCardFrame>
  )
}
