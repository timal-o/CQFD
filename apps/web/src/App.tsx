import { isValidCode, normalizeCode } from '@cqfd/shared'
import { Guide } from './ui/Guide'
import { Home } from './ui/Home'
import { Legal } from './ui/Legal'
import { NotFound } from './ui/NotFound'
import { RoomPage } from './ui/RoomPage'
import { usePathname } from './ui/router'

export function App() {
  const path = usePathname()
  if (path === '/guide' || path === '/guide/') return <Guide />
  if (path === '/mentions-legales' || path === '/mentions-legales/') return <Legal />
  if (path === '/' || path === '') return <Home />
  const match = path.match(/^\/s\/([^/]+)\/?$/)
  if (match) {
    let raw = match[1]!
    try {
      raw = decodeURIComponent(raw)
    } catch {
      // adresse mal encodée : traitée comme introuvable
    }
    const code = normalizeCode(raw)
    if (isValidCode(code)) return <RoomPage key={code} code={code} />
  }
  return <NotFound path={path} />
}
