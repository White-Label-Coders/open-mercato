'use client'

interface CopilotToggleProps {
  enabled: boolean
  onChange: (enabled: boolean) => void
}

export function CopilotToggle({ enabled, onChange }: CopilotToggleProps) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '4px 10px',
        backgroundColor: enabled ? '#dcfce7' : '#f1f5f9',
        border: `1px solid ${enabled ? '#86efac' : '#cbd5e1'}`,
        borderRadius: '16px', cursor: 'pointer',
        fontSize: '12px', fontWeight: 600,
        color: enabled ? '#166534' : '#64748b',
        transition: 'all 0.2s',
      }}
    >
      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: enabled ? '#22c55e' : '#94a3b8' }} />
      {enabled ? 'ON' : 'OFF'}
    </button>
  )
}
