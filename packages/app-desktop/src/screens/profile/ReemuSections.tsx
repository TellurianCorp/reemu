import { Button, makeStyles, tokens } from '@fluentui/react-components'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { GameCard } from '../../components/GameCard'
import { SectionHeader } from '../../components/SectionHeader'
import { Shelf } from '../../components/Shelf'
import { formatPlayTime } from '../../lib/playTime'
import { platformLabel } from '../../lib/platform'
import type { RomEntry } from '../../lib/tauri'
import { profileStats } from './profileData'

const useStyles = makeStyles({
  section: { marginTop: '26px' },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: '10px',
    '@media (max-width: 860px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  },
  stat: {
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: '14px 16px',
  },
  statValue: { fontSize: '26px', fontWeight: tokens.fontWeightSemibold, lineHeight: 1.2 },
  statLabel: { color: tokens.colorNeutralForeground3, fontSize: '12.5px', marginTop: '2px' },
  invite: { color: tokens.colorNeutralForeground2 },
  card: {
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: '16px 18px',
    minWidth: 0,
  },
  bars: { display: 'flex', flexDirection: 'column', rowGap: '10px' },
  bar: {
    display: 'grid',
    gridTemplateColumns: '36px minmax(0, 1fr) auto',
    columnGap: '10px',
    alignItems: 'center',
    width: '100%',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    padding: 0,
    color: 'inherit',
    cursor: 'pointer',
  },
  cover: {
    width: '36px',
    height: '48px',
    objectFit: 'cover',
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  barName: {
    fontSize: '13px',
    fontWeight: tokens.fontWeightSemibold,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  track: {
    height: '6px',
    backgroundColor: tokens.colorNeutralBackground5,
    borderRadius: tokens.borderRadiusSmall,
    marginTop: '5px',
  },
  fill: {
    height: '100%',
    backgroundColor: 'var(--reemuBrandAccent)',
    borderRadius: tokens.borderRadiusSmall,
  },
  barTime: {
    color: tokens.colorNeutralForeground2,
    fontSize: '12.5px',
    fontVariantNumeric: 'tabular-nums',
  },
})

/** "No ReEmu": os quatro números; biblioteca vazia, só o convite a jogar. */
export function ReemuNumbers({ roms }: { roms: RomEntry[] }) {
  const { t } = useTranslation()
  const s = useStyles()
  const stats = profileStats(roms)
  const items: { key: string; value: string; label: string }[] = [
    { key: 'time', value: formatPlayTime(stats.playTimeSecs), label: t('profilePage.statTime') },
    { key: 'games', value: String(stats.games), label: t('profilePage.statGames') },
    { key: 'systems', value: String(stats.systems), label: t('profilePage.statSystems') },
    { key: 'favorites', value: String(stats.favorites), label: t('profilePage.statFavorites') },
  ]
  return (
    <section className={s.section} data-testid="profile-numbers">
      <SectionHeader title={t('profilePage.reemuTitle')} subtitle={t('profilePage.reemuSub')} />
      {roms.length === 0 ? (
        <div className={s.invite}>{t('profilePage.invite')}</div>
      ) : (
        <div className={s.stats}>
          {items.map((i) => (
            <div key={i.key} className={s.stat}>
              <div className={s.statValue} data-stat={i.key}>
                {i.value}
              </div>
              <div className={s.statLabel}>{i.label}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** "Jogados recentemente": a prateleira da Home, com os jogos já ordenados. */
export function RecentRow({ roms }: { roms: RomEntry[] }) {
  const { t } = useTranslation()
  const s = useStyles()
  const navigate = useNavigate()
  if (roms.length === 0) return null
  return (
    <section className={s.section} data-testid="profile-recent">
      <SectionHeader title={t('profilePage.recent')} />
      <Shelf>
        {roms.map((r) => (
          <GameCard
            key={r.id}
            title={r.title}
            badge={platformLabel(r.systemId)}
            boxart={r.boxart}
            favorite={r.isFavorite}
            onClick={() => navigate(`/rom/${r.id}`)}
          />
        ))}
      </Shelf>
    </section>
  )
}

/** "Mais jogados no ReEmu": barras relativas ao jogo mais jogado. */
export function MostPlayedCard({ roms }: { roms: RomEntry[] }) {
  const { t } = useTranslation()
  const s = useStyles()
  const navigate = useNavigate()
  if (roms.length === 0) return null
  const top = roms[0].playTimeSecs
  return (
    <div className={s.card} data-testid="profile-most-played">
      <SectionHeader as="h3" title={t('profilePage.mostPlayed')} />
      <div className={s.bars}>
        {roms.map((r) => (
          <Button
            key={r.id}
            as="button"
            appearance="transparent"
            className={s.bar}
            aria-label={r.title}
            onClick={() => navigate(`/rom/${r.id}`)}
          >
            {r.boxart ? <img className={s.cover} src={r.boxart} alt="" loading="lazy" /> : <span className={s.cover} />}
            <span>
              <div className={s.barName}>{r.title}</div>
              <div className={s.track}>
                <div className={s.fill} style={{ width: `${Math.max(2, Math.round((r.playTimeSecs / top) * 100))}%` }} />
              </div>
            </span>
            <span className={s.barTime}>{formatPlayTime(r.playTimeSecs)}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}
