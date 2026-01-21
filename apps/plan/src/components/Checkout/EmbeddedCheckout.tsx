import { useCallback } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout as StripeEmbeddedCheckout,
} from '@stripe/react-stripe-js'

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)

interface EmbeddedCheckoutProps {
  clientSecret: string
  onComplete?: () => void
}

export function EmbeddedCheckout({ clientSecret, onComplete }: EmbeddedCheckoutProps) {
  const options = { clientSecret }

  const handleComplete = useCallback(() => {
    onComplete?.()
  }, [onComplete])

  return (
    <EmbeddedCheckoutProvider
      stripe={stripePromise}
      options={{
        ...options,
        onComplete: handleComplete,
      }}
    >
      <StripeEmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  )
}
