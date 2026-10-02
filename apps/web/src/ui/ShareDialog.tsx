import { useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'
import { X } from 'lucide-react'
import type { BoardStore } from '../board/store'
import { adminUrl, joinUrl, session } from '../lib/session'

function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <label className="copy-field">
      {label}
      <div className="copy-row">
        <input readOnly value={value} type={secret ? 'password' : 'text'} onFocus={(e) => e.target.select()} />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            } catch {
              // presse-papiers indisponible : le champ reste sélectionnable
            }
          }}
        >
          {copied ? 'Copié' : 'Copier'}
        </button>
      </div>
    </label>
  )
}

export function ShareDialog({ store, onClose }: { store: BoardStore; onClose: () => void }) {
  const url = joinUrl(store.code)
  const token = session.adminToken(store.code)
  const qr = useMemo(() => {
    const q = qrcode(0, 'M')
    q.addData(url)
    q.make()
    return q.createDataURL(6, 2)
  }, [url])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Partager la salle" onClick={(e) => e.stopPropagation()}>
        <button className="icon modal-close" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <h2>Rejoindre la salle</h2>
        <div className="share-grid">
          <div>
            <p className="muted">Code à donner aux élèves :</p>
            <div className="big-code mono">{store.code}</div>
            <p className="muted">à saisir sur {location.host}</p>
          </div>
          <img src={qr} alt={`QR code vers ${url}`} width={180} height={180} className="qr" />
        </div>
        <CopyField label="Lien direct pour les élèves" value={url} />
        {store.isAdmin && token && (
          <>
            <CopyField label="Lien administrateur (secret)" value={adminUrl(store.code, token)} secret />
            <CoAdmins store={store} />
            <p className="warning">
              Ce lien donne les droits de professeur : ne le partagez qu’avec un collègue de confiance. Il n’y a{' '}
              <strong>aucune sauvegarde</strong> : exportez votre travail avant de partir, la salle est effacée quand
              elle reste vide.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function CoAdmins({ store }: { store: BoardStore }) {
  const [label, setLabel] = useState('')
  const last = store.lastInvite
  return (
    <section className="coadmins">
      <h3>Co-admins</h3>
      <form
        className="copy-row"
        onSubmit={(e) => {
          e.preventDefault()
          store.send({ t: 'invite', label: label.trim() || 'Co-admin' })
          setLabel('')
        }}
      >
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nom du collègue" maxLength={40} aria-label="Nom du co-admin" />
        <button type="submit">Créer un lien</button>
      </form>
      {last && store.invites.some((i) => i.id === last.id) && (
        <CopyField label="Nouveau lien co-admin (affiché une seule fois)" value={adminUrl(store.code, last.token)} secret />
      )}
      {store.invites.length > 0 && (
        <ul className="invites">
          {store.invites.map((inv) => (
            <li key={inv.id}>
              <span>{inv.label}</span>
              <button type="button" className="small" onClick={() => store.send({ t: 'revokeInvite', id: inv.id })}>
                Révoquer
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
