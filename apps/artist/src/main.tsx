import './styles/index.css'
import App from './App'
import { bootstrapApp } from '@escapesuite/shared/bootstrap'

// ESCSUITE-212: a render-time throw anywhere in the tree is caught by the
// shared ErrorBoundary, which shows its own fallback panel regardless. ARTIST
// holds no live *capture* a crash could leave running — no recorder, no open
// MediaStream, unlike ESCAPECRAFT's useRecordingController — which is the gap
// this app's onError would otherwise exist to close. An export in flight
// still owns things that outlive the crashed render (a decodeWorker, its
// encoders), and the ruling is to leave those running rather than tear them
// down from an unrelated error — the panel's Reload ends them either way —
// so this is a deliberate no-op rather than an omitted prop, visible at the
// call site instead of looking like a follow-up nobody got to. The
// boundary's own componentDidCatch already logs the error in dev.
function onError(): void {}

bootstrapApp({ App, onError })
