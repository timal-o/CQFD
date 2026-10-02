export interface CreatedRoom {
  code: string
  adminToken: string
}

export async function createRoom(): Promise<CreatedRoom> {
  const res = await fetch('/api/rooms', { method: 'POST' })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Erreur ${res.status}`)
  }
  return (await res.json()) as CreatedRoom
}
