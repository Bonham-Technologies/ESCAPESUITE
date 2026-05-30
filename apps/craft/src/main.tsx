import './index.css'
import App from './App.tsx'
import { bootstrapApp } from '@escapesuite/shared/bootstrap'
import { isSaaSMode, StandaloneAuthGate } from './auth'

bootstrapApp({
  App,
  isSaaSMode,
  StandaloneAuthGate,
  importSaaSAuthGate: () => import('./auth'),
})
