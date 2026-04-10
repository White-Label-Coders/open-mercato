'use client'

import { useState } from 'react'
import type { ProductSuggestionCard } from '@open-mercato/voice-channels/modules/voice_channels/types'

interface Props { card: ProductSuggestionCard; onDismiss: () => void }

const dismissBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#94a3b8', padding: '2px 6px', borderRadius: '4px',
}

export function ProductCard({ card, onDismiss }: Props) {
  const [addedProductIds, setAddedProductIds] = useState<Set<string>>(new Set())
  return (
    <div style={{ backgroundColor: '#fff', borderRadius: '10px', border: '1px solid #e2e8f0', borderLeft: '4px solid #2563eb', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ padding: '12px 16px', backgroundColor: '#eff6ff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#1e40af' }}>📦 Sugestia produktu</span>
          <span style={{
            fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '8px',
            backgroundColor: card.matchConfidence >= 80 ? '#dcfce7' : '#fef9c3',
            color: card.matchConfidence >= 80 ? '#166534' : '#854d0e',
          }}>
            {card.matchConfidence}% match
          </span>
        </div>
        <button onClick={onDismiss} style={dismissBtnStyle}>✕</button>
      </div>
      <div style={{ padding: '12px 16px', fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
        &ldquo;{card.triggerText}&rdquo;
      </div>
      {card.products.map((product) => {
        const added = addedProductIds.has(product.id)
        return (
          <div key={product.id} style={{ padding: '12px 16px', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px', color: '#1e293b' }}>{product.name}</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>SKU: {product.sku}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, fontSize: '16px', color: '#059669' }}>
                  {product.price.amount.toFixed(2)} {product.price.currency}
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>{product.price.priceType}</div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
              <span style={{ fontSize: '12px', color: product.available ? '#059669' : '#dc2626', fontWeight: 500 }}>
                {product.available
                  ? `✓ W magazynie${product.stockQuantity ? ` (${product.stockQuantity} szt.)` : ''}`
                  : '✗ Brak w magazynie'}
              </span>
              <button
                onClick={() => setAddedProductIds((prev) => new Set(prev).add(product.id))}
                disabled={added}
                style={{
                  padding: '4px 12px',
                  backgroundColor: added ? '#dcfce7' : '#2563eb',
                  color: added ? '#166534' : '#fff',
                  border: added ? '1px solid #86efac' : 'none',
                  borderRadius: '4px', fontSize: '12px', fontWeight: 600,
                  cursor: added ? 'default' : 'pointer',
                  transition: 'all 0.3s ease',
                }}
              >
                {added ? '✓ Dodano do oferty' : '+ Dodaj do oferty'}
              </button>
            </div>
            {product.matchReason && (
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>{product.matchReason}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
