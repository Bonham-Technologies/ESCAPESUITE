import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout/Layout'
import Home from './pages/Home'
import NotFound from './pages/NotFound/NotFound'
import { PAGES } from './routes'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        {PAGES.map(({ path, Page }) => (
          <Route key={path} path={path} element={<Page />} />
        ))}
        {/* The hub's own document is a real file at /index.html (200 on the hosted
            site), so it goes home rather than showing a not-found page there. */}
        <Route path="index.html" element={<Navigate to="/" replace />} />
        {/* ESCSUITE-455: an unknown path shows the not-found page at its own URL. The
            hosted site serves the same page (dist/404.html) with status 404. */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export default App
