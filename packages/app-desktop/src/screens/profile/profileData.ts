import type { RomEntry } from '../../lib/tauri'

/** Números locais do perfil. `games` conta toda a biblioteca. */
export function profileStats(roms: RomEntry[]): {
  playTimeSecs: number
  games: number
  systems: number
  favorites: number
} {
  return {
    playTimeSecs: roms.reduce((s, r) => s + (r.playTimeSecs ?? 0), 0),
    games: roms.length,
    systems: new Set(roms.map((r) => r.systemId)).size,
    favorites: roms.filter((r) => r.isFavorite).length,
  }
}

/** Mesma regra da Home: só quem tem `lastPlayedAt`, o mais recente primeiro. */
export function recentlyPlayed(roms: RomEntry[], limit: number): RomEntry[] {
  return roms
    .filter((r) => r.lastPlayedAt != null)
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
    .slice(0, limit)
}

/** Só quem tem tempo de jogo, o maior primeiro (independe de `lastPlayedAt`). */
export function mostPlayed(roms: RomEntry[], limit: number): RomEntry[] {
  return roms
    .filter((r) => r.playTimeSecs > 0)
    .sort((a, b) => b.playTimeSecs - a.playTimeSecs)
    .slice(0, limit)
}

/** `pt` para `pt-BR`, `en` para o resto, depois qualquer valor presente. */
export function pickText(map: Record<string, string> | undefined, lang: string): string | null {
  if (!map) return null
  const preferred = lang.toLowerCase().startsWith('pt') ? 'pt' : 'en'
  for (const key of [preferred, 'en']) {
    if (map[key]) return map[key]
  }
  return Object.values(map).find((v) => !!v) ?? null
}

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Tinta (preto ou branco) com o maior contraste sobre `bg` (hex). */
export function readableInk(bg: string): '#000000' | '#ffffff' {
  const l = luminance(bg)
  const onBlack = (l + 0.05) / 0.05
  const onWhite = 1.05 / (l + 0.05)
  return onBlack >= onWhite ? '#000000' : '#ffffff'
}
