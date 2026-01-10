import './index.css'
import App from './App.tsx'
import { bootstrapApp } from '@escapesuite/shared/bootstrap'
import { isSaaSMode, StandaloneAuthGate } from './auth'

bootstrapApp({
  product: 'craft',
  App,
  isSaaSMode,
  StandaloneAuthGate,
  importSaaSAuthGate: () => import('./auth'),
  importClerkKey: () => import('./auth/config'),
  importSentry: () => import('./lib/sentry'),
})
