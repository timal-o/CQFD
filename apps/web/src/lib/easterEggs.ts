/**
 * Easter eggs. Tous locaux : rien n'est envoyé au serveur ni montré aux autres participants,
 * pour ne jamais perturber un cours.
 */

import { SITE } from '../site'

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ---------------------------------------------------------------- jour de π

/** Le 14 mars (ou avec `?pi` dans l'adresse, pour vérifier). */
export function isPiDay(now = new Date()): boolean {
  return (now.getMonth() === 2 && now.getDate() === 14) || new URLSearchParams(location.search).has('pi')
}

// ---------------------------------------------------------------- logo CQFD

/** Les autres sens de CQFD, un par clic sur le logo de l'accueil. */
export const CQFD_MEANINGS = [
  'Ce Qu’il Faut Démontrer',
  'Ça Qu’on Fera Demain',
  'Calcul Quasi Faux, Désolé',
  'Courbes, Quotients, Fonctions, Dérivées',
  'Café, Quiche, Frites, Dodo',
  'Corrigé Quasiment Fini, Demain',
  'Calculatrice Qui Fait Défaut',
  'Cours Quand Fatigué ? Dormir.',
]

// ---------------------------------------------------------------- code Konami

const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a']
const SYMBOLS = ['∑', '∫', 'π', '∞', '∂', '√', '∀', '∃', '∈', 'λ', 'Δ', 'θ', '≈', '∮', 'ℝ', 'ℕ', 'φ', 'ε', '∎']
const COLORS = ['#1d4ed8', '#dc2626', '#15803d', '#7c3aed', '#ea580c', '#0891b2']

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|MATH-FIELD)$/.test(t.tagName))

/** Pluie de symboles mathématiques sur l'écran de la personne qui a tapé le code. */
export function mathRain(): void {
  const layer = document.createElement('div')
  layer.className = 'math-rain'
  layer.setAttribute('aria-hidden', 'true')
  const count = reducedMotion() ? 0 : 80
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span')
    s.textContent = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]!
    s.style.left = `${Math.random() * 100}%`
    s.style.fontSize = `${18 + Math.random() * 30}px`
    s.style.color = COLORS[Math.floor(Math.random() * COLORS.length)]!
    s.style.animationDuration = `${2.5 + Math.random() * 2.5}s`
    s.style.animationDelay = `${Math.random() * 1.5}s`
    s.style.setProperty('--spin', `${(Math.random() - 0.5) * 720}deg`)
    layer.appendChild(s)
  }
  const banner = document.createElement('div')
  banner.className = 'math-rain-banner'
  banner.textContent = '↑↑↓↓←→←→BA : bien joué, vous avez trouvé le code secret ∎'
  layer.appendChild(banner)
  document.body.appendChild(layer)
  setTimeout(() => layer.remove(), 7000)
}

/** Écoute le code Konami partout dans l'application (sauf pendant une saisie de texte). */
export function listenKonami(): () => void {
  let progress = 0
  const onKey = (e: KeyboardEvent) => {
    if (isTyping(e.target)) return
    const key = e.key.toLowerCase()
    progress = key === KONAMI[progress] ? progress + 1 : key === KONAMI[0] ? 1 : 0
    if (progress === KONAMI.length) {
      progress = 0
      mathRain()
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}

// ---------------------------------------------------------------- console

const ASCII = String.raw`
  ____   ___   _____  ____
 / ___| / _ \ |  ___||  _ \ 
| |    | | | || |_   | | | |
| |___ | |_| ||  _|  | |_| |
 \____| \__\_\|_|    |____/  ∎
`

/** Message pour les curieux qui ouvrent la console du navigateur. */
export function consoleBanner(): void {
  const github = SITE.links.find((l) => l.kind === 'github')?.url
  console.log(`%c${ASCII}`, 'color:#1d4ed8;font-family:monospace;font-weight:bold;line-height:1.15')
  console.log(
    '%cCe Qu’il Faut Démontrer%c — le tableau blanc de maths de la classe.',
    'font-weight:bold;font-size:14px',
    'font-size:14px',
  )
  console.log(
    `%cTu lis la console ? Tu es des nôtres. 👋\n` +
      `Conçu et développé par Malo${github ? ` (${github})` : ''}.\n` +
      `Code source : ${github ? `${github}/CQFD` : 'sur GitHub'}\n` +
      `Propulsé par React, KaTeX, MathLive, mathjs, pdf.js et Cloudflare.\n` +
      `Indice pour la suite : ↑ ↑ ↓ ↓ ← → ← → B A`,
    'font-size:12px;line-height:1.6',
  )
  if (isPiDay()) console.log('%cπ ≈ 3,14159 26535 89793… Joyeux jour de π ! 🥧', 'font-size:13px;color:#7c3aed')
}
