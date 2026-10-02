import { BookOpen, ExternalLink } from 'lucide-react'
import { SITE, type SocialKind } from '../site'
import { navigate } from './router'

/** Logos simplifiés (les icônes de marque ne sont plus fournies par lucide). */
function BrandIcon({ kind }: { kind: SocialKind }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', 'aria-hidden': true, fill: 'currentColor' } as const
  switch (kind) {
    case 'github':
      return (
        <svg {...common}>
          <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
        </svg>
      )
    case 'youtube':
      return (
        <svg {...common}>
          <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z" />
        </svg>
      )
    case 'instagram':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
        </svg>
      )
    case 'tiktok':
      return (
        <svg {...common}>
          <path d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.7a5.7 5.7 0 1 0 4.9 5.7V9a7.4 7.4 0 0 0 4.3 1.4V7.3a4.3 4.3 0 0 1-3.2-1.5Z" />
        </svg>
      )
    default:
      return <ExternalLink size={18} aria-hidden />
  }
}

export function SocialLinks() {
  const links = SITE.links.filter((l) => l.url)
  if (links.length === 0) return null
  return (
    <div className="social-links">
      {links.map((l) => (
        <a key={l.kind + l.url} className="chip social" href={l.url} target="_blank" rel="noopener noreferrer" aria-label={l.label} title={l.label}>
          <BrandIcon kind={l.kind} />
        </a>
      ))}
    </div>
  )
}

/** En-tête des pages hors salle : logo à gauche, guide et liens à droite. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <a
        className="logo small site-logo"
        href="/"
        onClick={(e) => {
          e.preventDefault()
          navigate('/')
        }}
      >
        CQFD
      </a>
      <nav className="site-nav">
        <a
          className="chip"
          href="/guide"
          onClick={(e) => {
            e.preventDefault()
            navigate('/guide')
          }}
        >
          <BookOpen size={16} /> Guide
        </a>
        <SocialLinks />
      </nav>
    </header>
  )
}

export function SiteFooter() {
  const go = (path: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    navigate(path)
  }
  return (
    <footer className="site-footer">
      <a href="/guide" onClick={go('/guide')}>
        Guide
      </a>
      <span aria-hidden>·</span>
      <a href="/mentions-legales" onClick={go('/mentions-legales')}>
        Mentions légales et confidentialité
      </a>
    </footer>
  )
}
