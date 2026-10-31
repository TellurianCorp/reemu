import { makeStyles, tokens } from '@fluentui/react-components'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { SaveStateThumb } from '../../components/SaveStateThumb'
import { SectionHeader } from '../../components/SectionHeader'
import { formatPlayTime } from '../../lib/playTime'
import type { RecentSaveState } from '../../lib/tauri'

const useStyles = makeStyles({
  section: { marginTop: '26px' },
  row: { display: 'flex', columnGap: '10px', overflowX: 'auto', paddingBottom: '10px' },
  moment: {
    position: 'relative',
    flex: '0 0 240px',
    aspectRatio: '16 / 9',
    padding: 0,
    border: 'none',
    overflow: 'hidden',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    color: '#fff',
    cursor: 'pointer',
    textAlign: 'left',
  },
  thumb: { width: '100%', height: '100%' },
  cap: {
    position: 'absolute',
    insetInline: 0,
    bottom: 0,
    padding: '18px 10px 7px',
    fontSize: '12px',
    backgroundImage: 'linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.85))',
  },
  capTitle: { display: 'block', fontSize: '12.5px', fontWeight: tokens.fontWeightSemibold },
})

/** "Seus momentos": as capturas dos saves mais recentes; sem nenhum, some. */
export function MomentsRow({ states }: { states: RecentSaveState[] }) {
  const { t } = useTranslation()
  const s = useStyles()
  const navigate = useNavigate()
  if (states.length === 0) return null
  return (
    <section className={s.section} data-testid="profile-moments">
      <SectionHeader title={t('profilePage.moments')} subtitle={t('profilePage.momentsSub')} />
      <div className={s.row}>
        {states.map((st) => {
          const slot = st.slot == null ? t('profilePage.auto') : t('profilePage.slot', { n: st.slot })
          const played =
            st.playTimeAtSave != null && st.playTimeAtSave > 0
              ? ` · ${t('profilePage.playedAtSave', { time: formatPlayTime(st.playTimeAtSave) })}`
              : ''
          return (
            <button key={st.id} type="button" className={s.moment} onClick={() => navigate(`/rom/${st.romId}`)}>
              <SaveStateThumb stateId={st.id} hasThumbnail className={s.thumb} />
              <span className={s.cap}>
                <span className={s.capTitle}>{st.romTitle}</span>
                {slot}
                {played}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
