import type { BoardStore } from '../board/store'

/** Heure de Paris à laquelle les quotas journaliers repartent (00:00 UTC). */
function resetTimeParis(): string {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return next.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })
}

/**
 * Alerte de quota, calculée par le serveur pour la salle. La consommation globale du
 * compte se consulte dans le tableau de bord Cloudflare (aucune adresse publique ne l'expose).
 */
export function QuotaBanner({ store }: { store: BoardStore }) {
  const admin = store.isAdmin
  const reset = resetTimeParis()
  let text: string | null = null
  let level = 'warn'
  if (store.quota === 'exceeded') {
    level = 'danger'
    text = `Quota gratuit du jour atteint : le tableau est en lecture seule jusqu’à ${reset}. Exportez votre travail.`
  } else if (store.quota === 'degraded') {
    text = 'Mode économie : le laser est coupé et le tracé en direct ralenti pour ne pas dépasser le quota gratuit.'
  } else if (admin && store.quota === 'warn') {
    text = 'Activité très élevée aujourd’hui dans cette salle : le quota gratuit pourrait être atteint.'
  }
  if (!text) return null
  return (
    <div className={`quota-banner ${level}`} role="status">
      {text}
    </div>
  )
}
