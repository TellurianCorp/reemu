import { describe, expect, it } from 'vitest'
import type { RomEntry } from '../../lib/tauri'
import {
  cardComputedAt,
  cardLag,
  hasCardContent,
  mostPlayed,
  pickText,
  playingNow,
  profileStats,
  readableInk,
  recentlyPlayed,
} from './profileData'

const rom = (id: string, o: Partial<RomEntry> = {}): RomEntry => ({
  id,
  title: id,
  systemId: 'nes',
  filePath: `/${id}`,
  boxart: null,
  lastPlayedAt: null,
  addedAt: 0,
  isFavorite: false,
  playTimeSecs: 0,
  ...o,
})

const fixture = [
  rom('a', { playTimeSecs: 0 }),
  rom('b', { playTimeSecs: 90, systemId: 'snes', isFavorite: true, lastPlayedAt: 10 }),
  rom('c', { playTimeSecs: 3600, lastPlayedAt: 20 }),
  rom('d', { playTimeSecs: 0, systemId: 'snes' }),
]

describe('profileStats', () => {
  it('soma tempo, jogos, sistemas e favoritos', () => {
    expect(profileStats(fixture)).toEqual({ playTimeSecs: 3690, games: 4, systems: 2, favorites: 1 })
  })
})

describe('listas', () => {
  it('ROM com tempo e sem lastPlayedAt entra em mostPlayed e não em recentlyPlayed', () => {
    const roms = [rom('x', { playTimeSecs: 500, lastPlayedAt: null }), ...fixture]
    expect(mostPlayed(roms, 10).map((r) => r.id)).toEqual(['c', 'x', 'b'])
    expect(recentlyPlayed(roms, 10).map((r) => r.id)).toEqual(['c', 'b'])
  })
  it('respeita o limite', () => {
    expect(mostPlayed(fixture, 1).map((r) => r.id)).toEqual(['c'])
    expect(recentlyPlayed(fixture, 1).map((r) => r.id)).toEqual(['c'])
  })
})

describe('pickText', () => {
  it('escolhe o idioma, cai para en e depois para qualquer valor', () => {
    expect(pickText({ pt: 'Colecionador', en: 'Collector' }, 'es')).toBe('Collector')
    expect(pickText({ pt: 'Colecionador', en: 'Collector' }, 'pt-BR')).toBe('Colecionador')
    expect(pickText({ ja: 'x' }, 'pt-BR')).toBe('x')
    expect(pickText(undefined, 'en')).toBeNull()
  })
})

describe('readableInk', () => {
  it('escolhe a tinta com contraste mínimo de 4.5:1', () => {
    expect(readableInk('#AD9F85')).toBe('#000000')
    expect(readableInk('#1B2F13')).toBe('#ffffff')
  })
})

describe('idade do cartão', () => {
  const at = Date.UTC(2026, 9, 28, 12) / 1000
  const card = { computed_at: new Date(at * 1000).toISOString(), playing_now: { title: 'Kuon' } }

  it('lê o computed_at em RFC 3339 e recusa o instante zero do servidor', () => {
    expect(cardComputedAt(card)).toBe(at)
    expect(cardComputedAt({ computed_at: '0001-01-01T00:00:00Z' })).toBeNull()
    expect(cardComputedAt({ computed_at: 'ontem' })).toBeNull()
    expect(cardComputedAt({})).toBeNull()
  })

  it('a defasagem é contra a leitura do status', () => {
    expect(cardLag(card, at + 600)).toBe(600)
    expect(cardLag(card, null)).toBeNull()
    expect(cardLag({}, at)).toBeNull()
  })

  it('jogando agora some depois de meia hora de defasagem', () => {
    expect(playingNow(card, at + 29 * 60)?.title).toBe('Kuon')
    expect(playingNow(card, at + 31 * 60)).toBeUndefined()
    // sem as datas não dá para saber: fica
    expect(playingNow(card, null)?.title).toBe('Kuon')
  })
})

describe('hasCardContent', () => {
  it('só nível não é conteúdo de "No Alvanista"', () => {
    expect(hasCardContent({ identity: { level: 3 } }, null)).toBe(false)
    expect(hasCardContent({ ledger: { hours: 1 } }, null)).toBe(true)
    expect(hasCardContent({ badges: { count: 2, recent: [] } }, null)).toBe(true)
  })

  it('um jogo de agora velho não segura a seção sozinho', () => {
    const at = 1_700_000_000
    const card = { computed_at: new Date(at * 1000).toISOString(), playing_now: { title: 'Kuon' } }
    expect(hasCardContent(card, at + 60)).toBe(true)
    expect(hasCardContent(card, at + 3 * 86400)).toBe(false)
  })
})
