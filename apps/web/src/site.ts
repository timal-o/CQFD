/**
 * Informations du site : liens affichés en haut à droite et contact des mentions légales.
 * Une URL vide masque le bouton correspondant.
 */

export type SocialKind = 'github' | 'youtube' | 'instagram' | 'tiktok' | 'link'

export interface SocialLink {
  kind: SocialKind
  label: string
  url: string
}

export const SITE = {
  links: [
    { kind: 'github', label: 'GitHub', url: 'https://github.com/timal-o' },
    { kind: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@timalo_' },
    { kind: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/timalofpv/' },
  ] satisfies SocialLink[] as SocialLink[],

  /** Adresse de contact (mentions légales, demandes sur les données). Vide = non affichée. */
  contactEmail: '',

  /**
   * Nom de l'éditeur. Facultatif : un particulier qui édite un site à titre non professionnel
   * peut rester anonyme et n'indiquer que l'hébergeur (LCEN, art. 6-III-2).
   */
  publisher: '',
}
