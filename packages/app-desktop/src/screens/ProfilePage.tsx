import { makeStyles } from '@fluentui/react-components'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { LoadingState } from '../components/EmptyState'
import { ALVANISTA_CACHED_KEY, useEffectiveProfile } from '../hooks/useEffectiveProfile'
import {
  alvanistaCachedStatus,
  alvanistaStatus,
  listRecentSaveStates,
  listRoms,
} from '../lib/tauri'
import { MomentsRow } from './profile/MomentsRow'
import { ProfileHero } from './profile/ProfileHero'
import { mostPlayed, recentlyPlayed } from './profile/profileData'
import { MostPlayedCard, RecentRow, ReemuNumbers } from './profile/ReemuSections'

/** Mesma chave do `SettingsProfile`: as duas telas dividem o status completo. */
const STATUS_KEY = ['alvanista-status'] as const

const useStyles = makeStyles({
  page: { width: '100%', paddingBottom: '40px' },
  cols: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: '14px',
    marginTop: '26px',
    '@media (max-width: 860px)': { gridTemplateColumns: '1fr' },
  },
})

/**
 * Meu perfil (`/perfil`), tela cheia na área de conteúdo da casca: o topo,
 * "No ReEmu", "Jogados recentemente", "Mais jogados no ReEmu" e "Seus
 * momentos". Só lê a biblioteca, os saves, o perfil local e o status do
 * Alvanista (guardado e completo); sem sessão não toca no chaveiro nem na rede.
 */
export function ProfilePage() {
  const s = useStyles()
  const profile = useEffectiveProfile()
  const roms = useQuery({ queryKey: ['roms'], queryFn: listRoms, retry: false })
  const saves = useQuery({
    queryKey: ['recent-save-states', 8],
    queryFn: () => listRecentSaveStates(8),
    retry: false,
  })
  // Primeiro o guardado (instantâneo), depois o completo, como no SettingsProfile.
  const cached = useQuery({ queryKey: ALVANISTA_CACHED_KEY, queryFn: alvanistaCachedStatus, retry: false })
  const full = useQuery({ queryKey: STATUS_KEY, queryFn: alvanistaStatus, retry: false })
  const status = full.data ?? cached.data

  const all = useMemo(() => roms.data ?? [], [roms.data])
  const recent = useMemo(() => recentlyPlayed(all, 30), [all])
  const most = useMemo(() => mostPlayed(all, 5), [all])

  if (!profile || roms.isPending) return <LoadingState />

  return (
    <div className={s.page}>
      <ProfileHero
        profile={profile}
        status={status}
        onRefresh={() => void full.refetch()}
        refreshing={full.isFetching}
      />
      <ReemuNumbers roms={all} />
      <RecentRow roms={recent} />
      <div className={s.cols}>
        <MostPlayedCard roms={most} />
        {/* "No Alvanista" entra aqui, ao lado de "Mais jogados". */}
      </div>
      <MomentsRow states={saves.data ?? []} />
    </div>
  )
}
