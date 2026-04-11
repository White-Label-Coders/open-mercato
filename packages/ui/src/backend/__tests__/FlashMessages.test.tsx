import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { FlashMessages, flash, notify } from '../FlashMessages'

describe('FlashMessages', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    window.history.replaceState({}, '', 'http://localhost/backend')
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    window.history.replaceState({}, '', 'http://localhost/backend')
  })

  it('auto-dismisses URL-based flashes after stripping query params', () => {
    window.history.replaceState({}, '', 'http://localhost/backend/checkout/pay-links?flash=Saved&type=success')

    renderWithProviders(<FlashMessages />)

    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(window.location.search).toBe('')

    act(() => {
      jest.advanceTimersByTime(3000)
    })

    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('auto-dismisses programmatic flashes', () => {
    renderWithProviders(<FlashMessages />)

    act(() => {
      flash('Pay link published', 'success')
    })

    expect(screen.getByText('Pay link published')).toBeInTheDocument()

    act(() => {
      jest.advanceTimersByTime(3000)
    })

    expect(screen.queryByText('Pay link published')).not.toBeInTheDocument()
  })

  it('renders an action button for notify payloads', () => {
    const onClick = jest.fn()

    renderWithProviders(<FlashMessages />)

    act(() => {
      notify({
        message: 'Quote created',
        type: 'success',
        action: {
          label: 'Open quote',
          onClick,
        },
      })
    })

    expect(screen.getByText('Quote created')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open quote' }))

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Quote created')).not.toBeInTheDocument()
  })
})
