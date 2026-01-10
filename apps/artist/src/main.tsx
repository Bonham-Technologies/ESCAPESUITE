import './styles/index.css'
import App from './App'
import { bootstrapApp } from '@escapesuite/shared/bootstrap'
import { isSaaSMode, StandaloneAuthGate } from './auth'

bootstrapApp({
  product: 'artist',
  App,
  isSaaSMode,
  StandaloneAuthGate,
  importSaaSAuthGate: () => import('./auth'),
  importClerkKey: () => import('./auth/config'),
  importSentry: () => import('./lib/sentry'),
})
