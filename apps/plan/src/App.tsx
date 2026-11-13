import { Routes, Route } from 'react-router-dom'
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
        {/* ESCSUITE-455: an unknown path shows the not-found page at its own URL. The
            hosted site serves the same page (dist/404.html) with status 404. */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export default App
