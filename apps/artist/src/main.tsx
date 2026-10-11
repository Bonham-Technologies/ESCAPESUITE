import './styles/index.css'
import App from './App'
import { bootstrapApp } from '@escapesuite/shared/bootstrap'
import { disposeLiveExport } from './components/Export/liveExport'

// ESCSUITE-212 / ESCSUITE-220: a render-time throw anywhere in the tree is
// caught by the shared ErrorBoundary, which shows its own fallback panel
// regardless. ARTIST holds no live capture, but an export in flight owns
// things that outlive the crashed render — a decodeWorker, one or two
// encoders, a muxer — and its only release paths are its own completion,
// failure and Cancel, none of which a crash reaches. So onError stops it:
// disposeLiveExport() aborts the run ExportDialog registered, exactly once,
// and is a no-op when nothing is exporting. The boundary's own
// componentDidCatch already logs the error in dev.
function onError(): void {
  disposeLiveExport()
}

bootstrapApp({ App, onError })
