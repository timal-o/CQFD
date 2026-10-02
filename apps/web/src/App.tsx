import { isValidCode, normalizeCode } from '@cqfd/shared'
import { Home } from './ui/Home'
import { RoomPage } from './ui/RoomPage'
import { usePathname } from './ui/router'

export function App() {
  const path = usePathname()
  const match = path.match(/^\/s\/([^/]+)\/?$/)
  if (match) {
    const code = normalizeCode(decodeURIComponent(match[1]!))
    if (isValidCode(code)) return <RoomPage key={code} code={code} />
  }
  return <Home />
}
