// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlvanistaStatus, RecentSaveState, RomEntry } from '../lib/tauri'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const api = vi.hoisted(() => ({
  listRoms: vi.fn(),
  listRecentSaveStates: vi.fn(),
  saveThumbnailUrl: vi.fn(),
  getProfile: vi.fn(),
  alvanistaStatus: vi.fn(),
  alvanistaCachedStatus: vi.fn(),
  alvanistaOpenProfile: vi.fn(),
  alvanistaOpenSite: vi.fn(),
}))

vi.mock('../lib/tauri', async (orig) => ({
  ...(await orig<typeof import('../lib/tauri')>()),
  ...api,
}))

import { ProfilePage } from './ProfilePage'

const OFF: AlvanistaStatus = {
  connected: false,
  username: null,
  avatar_url: null,
  hero_url: null,
  bio: null,
  profile_url: null,
  offline: false,
  insecure_storage: false,
  ended: false,
  card: null,
  fetched_at: null,
  connected_at: null,
  device_label: null,
}
const ON: AlvanistaStatus = {
  ...OFF,
  connected: true,
  username: 'toy',
  avatar_url: 'https://cdn.alvanista.com/a/toy.png',
  hero_url: 'https://cdn.alvanista.com/h/toy.png',
  bio: 'bio do Alvanista',
  profile_url: 'https://www.alvanista.com/users/toy',
}

const rom = (id: string, over: Partial<RomEntry> = {}): RomEntry => ({
  id,
  title: `Jogo ${id}`,
  systemId: 'snes',
  filePath: `/r/${id}`,
  boxart: null,
  lastPlayedAt: null,
  addedAt: 1,
  isFavorite: false,
  playTimeSecs: 0,
  ...over,
})

let host: HTMLDivElement
let unmount: () => Promise<void>

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/perfil']}>
          <Routes>
            <Route path="/perfil" element={<ProfilePage />} />
            <Route path="/settings/perfil" element={<div>tela de ajustes</div>} />
            <Route path="/rom/:romId" element={<div>tela do jogo</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  )
  await settle()
  unmount = () => act(async () => root.unmount())
}

const byText = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))
const section = (id: string) => host.querySelector(`[data-testid="${id}"]`)

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset())
  api.listRoms.mockResolvedValue([])
  api.listRecentSaveStates.mockResolvedValue([])
  api.saveThumbnailUrl.mockResolvedValue(null)
  api.getProfile.mockResolvedValue({ name: 'Local', bio: 'bio local', avatar: 'preset:2', onboarded: true })
  api.alvanistaStatus.mockResolvedValue(OFF)
  api.alvanistaCachedStatus.mockResolvedValue(OFF)
  api.alvanistaOpenProfile.mockResolvedValue(undefined)
  api.alvanistaOpenSite.mockResolvedValue(undefined)
})
afterEach(async () => {
  await unmount()
  host.remove()
})

describe('ProfilePage', () => {
  it('local profile: theme banner, local name and bio, Editar perfil goes to /settings/perfil, no chips', async () => {
    await mount()
    const banner = section('profile-banner') as HTMLElement
    expect(banner).toBeTruthy()
    expect(banner.style.backgroundImage).toBe('')
    expect(host.textContent).toContain('Local')
    expect(host.textContent).toContain('bio local')
    expect(section('profile-chips')).toBeNull()
    expect(byText('Ver no Alvanista')).toBeUndefined()
    await act(async () => byText('Editar perfil')!.click())
    await settle()
    expect(document.body.textContent).toContain('tela de ajustes')
  })

  it('connected without card: Alvanista name, avatar and bio, Ver no Alvanista and Editar no Alvanista, no chips', async () => {
    api.alvanistaCachedStatus.mockResolvedValue(ON)
    api.alvanistaStatus.mockResolvedValue(ON)
    await mount()
    expect(host.textContent).toContain('toy')
    expect(host.textContent).toContain('bio do Alvanista')
    expect(host.textContent).not.toContain('bio local')
    expect(host.querySelector('img[src="https://cdn.alvanista.com/a/toy.png"]')).toBeTruthy()
    expect((section('profile-banner') as HTMLElement).style.backgroundImage).toContain('h/toy.png')
    expect(section('profile-chips')).toBeNull()
    await act(async () => byText('Ver no Alvanista')!.click())
    expect(api.alvanistaOpenProfile).toHaveBeenCalledTimes(1)
    await act(async () => byText('Editar no Alvanista')!.click())
    expect(api.alvanistaOpenSite).toHaveBeenCalledWith('edit')
    expect(byText('Editar perfil')).toBeUndefined()
  })

  it('connected without Alvanista bio shows no bio even with a local bio', async () => {
    const st = { ...ON, bio: null }
    api.alvanistaCachedStatus.mockResolvedValue(st)
    api.alvanistaStatus.mockResolvedValue(st)
    await mount()
    expect(host.textContent).toContain('toy')
    expect(host.textContent).not.toContain('bio local')
  })

  it('banner follows the card hero position', async () => {
    const st = { ...ON, card: { identity: { hero_position_x: 20, hero_position_y: 70 } } }
    api.alvanistaCachedStatus.mockResolvedValue(st)
    api.alvanistaStatus.mockResolvedValue(st)
    await mount()
    expect((section('profile-banner') as HTMLElement).style.backgroundPosition).toBe('20% 70%')
  })

  it('No ReEmu shows the four numbers', async () => {
    api.listRoms.mockResolvedValue([
      rom('a', { playTimeSecs: 3600, isFavorite: true }),
      rom('b', { playTimeSecs: 1800, systemId: 'n64' }),
      rom('c', { systemId: 'n64' }),
    ])
    await mount()
    const s = section('profile-numbers')!
    expect(s.textContent).toContain('1 h 30 min')
    expect(s.textContent).toContain('Jogos na biblioteca')
    expect(s.textContent).toContain('Sistemas')
    expect(s.textContent).toContain('Favoritos')
    expect(s.textContent).toContain('Tempo jogado')
    const stat = (k: string) => s.querySelector(`[data-stat="${k}"]`)?.textContent
    expect(stat('games')).toBe('3')
    expect(stat('systems')).toBe('2')
    expect(stat('favorites')).toBe('1')
  })

  it('an empty library shows the invitation line and hides the shelves', async () => {
    await mount()
    const s = section('profile-numbers')!
    expect(s.textContent).toContain('Jogue algo para ver seus números aqui.')
    expect(s.querySelector('[data-stat]')).toBeNull()
    expect(section('profile-recent')).toBeNull()
    expect(section('profile-most-played')).toBeNull()
    expect(section('profile-moments')).toBeNull()
  })

  it('recent and most played follow profileData', async () => {
    api.listRoms.mockResolvedValue([
      rom('old', { title: 'Antigo', lastPlayedAt: 100, playTimeSecs: 9000 }),
      rom('new', { title: 'Novo', lastPlayedAt: 900, playTimeSecs: 60 }),
    ])
    await mount()
    const first = (id: string) => section(id)!.querySelector('button, [role="button"]')!.getAttribute('aria-label')
    expect(first('profile-recent')).toBe('Novo')
    expect(first('profile-most-played')).toBe('Antigo')
    await act(async () => (section('profile-recent')!.querySelector('button, [role="button"]') as HTMLElement).click())
    await settle()
    expect(document.body.textContent).toContain('tela do jogo')
  })

  it('moments hide when there are no saves with thumbnails', async () => {
    api.listRoms.mockResolvedValue([rom('a', { playTimeSecs: 60 })])
    await mount()
    expect(section('profile-moments')).toBeNull()
  })

  it('moments show title and slot', async () => {
    const saves: RecentSaveState[] = [
      { id: 's1', romId: 'a', romTitle: 'Kuon', slot: 2, createdAt: 1, playTimeAtSave: 3600 },
      { id: 's2', romId: 'b', romTitle: 'Killzone 2', slot: null, createdAt: 2, playTimeAtSave: null },
    ]
    api.listRoms.mockResolvedValue([rom('a', { playTimeSecs: 60 })])
    api.listRecentSaveStates.mockResolvedValue(saves)
    await mount()
    const s = section('profile-moments')!
    expect(s.textContent).toContain('Kuon')
    expect(s.textContent).toContain('Slot 2')
    expect(s.textContent).toContain('Killzone 2')
    expect(s.textContent).toContain('Auto')
  })

  it('offline shows the badge and the last profile', async () => {
    const st = { ...ON, offline: true, insecure_storage: true, fetched_at: 1 }
    api.alvanistaCachedStatus.mockResolvedValue(st)
    api.alvanistaStatus.mockResolvedValue(st)
    await mount()
    expect(host.textContent).toContain('Sem conexão: mostrando o último perfil salvo')
    expect(host.textContent).toContain('O chaveiro do sistema não está disponível')
    expect(host.textContent).toContain('toy')
  })

  it('Atualizado is hidden without fetched_at and the refresh button refetches the status', async () => {
    api.alvanistaCachedStatus.mockResolvedValue(ON)
    api.alvanistaStatus.mockResolvedValue(ON)
    await mount()
    expect(host.textContent).not.toContain('Atualizado')
    const refresh = () => host.querySelector('[aria-label="Atualizar agora"]') as HTMLElement
    expect(refresh()).toBeTruthy()
    const before = api.alvanistaStatus.mock.calls.length
    await act(async () => refresh().click())
    await settle()
    expect(api.alvanistaStatus.mock.calls.length).toBe(before + 1)
  })
})
