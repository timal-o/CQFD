/** Limites partagées entre client et serveur. */
export const LIMITS = {
  nameMaxLength: 24,
  pageNameMaxLength: 40,
  maxPages: 100,
  maxElementsPerRoom: 20_000,
  maxOpsPerMessage: 500,
  maxStrokeNumbers: 30_000, // triplets x, y, pression
  maxLiveNumbers: 3_000,
  maxLaserNumbers: 200,
  maxTextChars: 20_000,
  maxLatexChars: 5_000,
  maxMessageBytes: 1_000_000,
  minParticipants: 2,
  maxParticipants: 50,
} as const

/** Fréquences d'envoi côté client (ms entre deux messages). */
export const SEND_INTERVALS = {
  live: 66, // ~15 Hz pour le tracé en direct
  laser: 66, // ~15 Hz pour le laser
  heartbeat: 20_000,
} as const

export const HEARTBEAT_REQUEST = 'ping'
export const HEARTBEAT_RESPONSE = 'pong'
