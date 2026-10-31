import { makeStyles } from '@fluentui/react-components'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { LoadingState } from '../components/EmptyState'
import { ALVANISTA_STATUS_KEY, DISCONNECTED, useAlvanistaStatusSync } from '../hooks/useAlvanistaStatusSync'
import { ALVANISTA_CACHED_KEY, useEffectiveProfile } from '../hooks/useEffectiveProfile'
import {
  alvanistaCachedStatus,
  alvanistaStatus,
  listRecentSaveStates,
  listRoms,
} from '../lib/tauri'
import { AlvanistaCardBlock, AlvanistaInvite } from './profile/AlvanistaCardBlock'
import { ConnectionCard } from './profile/ConnectionCard'
import { MomentsRow } from './profile/MomentsRow'
import { ProfileHero } from './profile/ProfileHero'
import { mostPlayed, recentlyPlayed } from './profile/profileData'
import { MostPlayedCard, RecentRow, ReemuNumbers } from './profile/ReemuSections'

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
 * momentos", "No Alvanista" (ou o convite) e "Conexão com o Alvanista". Só lê a
 * biblioteca, os saves, o perfil local e o status do Alvanista (guardado e completo); sem sessão não toca no chaveiro nem na rede.
 */
export function ProfilePage() {
  const s = useStyles()
  const profile = useEffectiveProfile()
  // staleTime 0: leituras baratas do SQLite, relidas a cada vez que a página abre
  // (jogar e salvar não invalidam estas chaves).
  const roms = useQuery({ queryKey: ['roms'], queryFn: listRoms, retry: false, staleTime: 0 })
  const saves = useQuery({
    queryKey: ['recent-save-states', 8],
    queryFn: () => listRecentSaveStates(8),
    retry: false,
    staleTime: 0,
  })
  // Primeiro o guardado (instantâneo), depois o completo, como no SettingsProfile.
  const cached = useQuery({ queryKey: ALVANISTA_CACHED_KEY, queryFn: alvanistaCachedStatus, retry: false })
  const full = useQuery({ queryKey: ALVANISTA_STATUS_KEY, queryFn: alvanistaStatus, retry: false })
  const status = full.data ?? cached.data
  useAlvanistaStatusSync(status ?? DISCONNECTED, full.data, cached.data)

  const all = useMemo(() => roms.data ?? [], [roms.data])
  const recent = useMemo(() => recentlyPlayed(all, 30), [all])
  const most = useMemo(() => mostPlayed(all, 5), [all])

  if (!profile || roms.isPending) return <LoadingState />
  // Pelo status, não pelo perfil: ao desconectar o status zera na hora.
  const connected = !!status?.connected

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
        {connected ? (
          status?.card ? <AlvanistaCardBlock card={status.card} /> : null
        ) : (
          <AlvanistaInvite />
        )}
      </div>
      <MomentsRow states={saves.data ?? []} />
      {connected && status && <ConnectionCard status={status} />}
    </div>
  )
}
