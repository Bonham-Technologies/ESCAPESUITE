import './styles/index.css'
import App from './App'
import { bootstrapApp } from '@escapesuite/shared/bootstrap'

// ESCSUITE-212: a render-time throw anywhere in the tree is caught by the
// shared ErrorBoundary, which shows its own fallback panel regardless. ARTIST
// holds no live capture a crash could leave running — no recorder, no open
// MediaStream, unlike ESCAPECRAFT's useRecordingController — so there is
// nothing for this app to release here; it is a deliberate no-op rather than
// an omitted prop, so the absence of work is visible at the call site instead
// of looking like a follow-up nobody got to. The boundary's own
// componentDidCatch already logs the error in dev.
function onError(): void {}

bootstrapApp({ App, onError })
