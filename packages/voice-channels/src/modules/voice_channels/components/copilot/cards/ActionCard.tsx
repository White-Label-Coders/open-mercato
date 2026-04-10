'use client'

import type { QuickActionCard } from '@open-mercato/voice-channels/modules/voice_channels/types'

interface Props { card: QuickActionCard; onDismiss: () => void }

const dismissBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#94a3b8', padding: '2px 6px', borderRadius: '4px',
}

export function ActionCard({ card, onDismiss }: Props) {
  const handleAction = (actionType: string) => {
    window.alert(`Akcja: ${actionType} — w produkcji otworzy formularz.`)
  }

  return (
    <div style={{ backgroundColor: '#fff', borderRadius: '10px', border: '1px solid #e2e8f0', borderLeft: '4px solid #22c55e', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ padding: '12px 16px', backgroundColor: '#f0fdf4', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#166534' }}>⚡ Szybkie akcje</span>
        <button onClick={onDismiss} style={dismissBtnStyle}>✕</button>
      </div>
      <div style={{ padding: '12px 16px', fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
        &ldquo;{card.triggerText}&rdquo;
      </div>
      <div style={{ padding: '0 16px 16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {card.actions.map((action, i) => (
          <button
            key={i}
            onClick={() => handleAction(action.actionType)}
            style={{
              padding: '8px 16px', backgroundColor: '#f0fdf4', color: '#166534',
              border: '1px solid #bbf7d0', borderRadius: '6px',
              fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}
