import './index.css'
import App from './App.tsx'
import { bootstrapApp } from '@escapesuite/shared/bootstrap'
import { disposeLiveRecordingSession } from './hooks/useRecordingController'

// ESCSUITE-212: a render-time throw anywhere in the tree must not leave a
// live recorder capturing into a UI nobody can see or stop — see
// useRecordingController's disposeLiveRecordingSession and
// @escapesuite/shared's ErrorBoundary.
bootstrapApp({ App, onError: disposeLiveRecordingSession })
