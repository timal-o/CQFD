import { isValidCode, normalizeCode } from '@cqfd/shared'
import { Guide } from './ui/Guide'
import { Home } from './ui/Home'
import { Legal } from './ui/Legal'
import { RoomPage } from './ui/RoomPage'
import { usePathname } from './ui/router'

export function App() {
  const path = usePathname()
  if (path === '/guide' || path === '/guide/') return <Guide />
  if (path === '/mentions-legales' || path === '/mentions-legales/') return <Legal />
  const match = path.match(/^\/s\/([^/]+)\/?$/)
  if (match) {
    const code = normalizeCode(decodeURIComponent(match[1]!))
    if (isValidCode(code)) return <RoomPage key={code} code={code} />
  }
  return <Home />
}
