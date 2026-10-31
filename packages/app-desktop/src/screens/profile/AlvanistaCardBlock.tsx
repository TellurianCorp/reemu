import { Button, MessageBar, MessageBarBody, Spinner, makeStyles, tokens } from '@fluentui/react-components'
import { useTranslation } from 'react-i18next'
import symbol from '../../assets/alvanista-symbol.svg'
import { AlvanistaButton } from '../../components/AlvanistaButton'
import { SectionHeader } from '../../components/SectionHeader'
import { useAlvanistaConnect } from '../../hooks/useAlvanistaConnect'
import type { AlvanistaCard } from '../../lib/tauri'
import { pickText } from './profileData'

const useStyles = makeStyles({
  card: {
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: '16px 18px',
    minWidth: 0,
  },
  title: { display: 'flex', alignItems: 'center', columnGap: '8px' },
  symbol: { width: '20px', height: '20px', flexShrink: 0, marginBottom: '14px' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '14px 16px',
  },
  value: { fontSize: '22px', fontWeight: tokens.fontWeightSemibold, lineHeight: 1.2 },
  label: { color: tokens.colorNeutralForeground3, fontSize: '12.5px', marginTop: '2px' },
  nets: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '5px' },
  net: {
    fontSize: '11px',
    padding: '1px 7px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
  },
  badges: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginTop: '16px' },
  badge: { width: '40px', height: '40px', objectFit: 'contain', borderRadius: tokens.borderRadiusSmall },
  more: { color: tokens.colorNeutralForeground2, fontSize: '13px' },
  now: { display: 'flex', alignItems: 'center', columnGap: '12px', marginTop: '16px' },
  nowCover: {
    width: '36px',
    height: '48px',
    objectFit: 'cover',
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  nowTitle: { fontWeight: tokens.fontWeightSemibold, fontSize: '13.5px', overflowWrap: 'anywhere' },
  promo: { display: 'flex', alignItems: 'center', columnGap: '16px' },
  promoSymbol: { width: '40px', height: '40px', flexShrink: 0 },
  promoText: { margin: '0 0 10px', color: tokens.colorNeutralForeground2, lineHeight: 1.45 },
  waiting: { display: 'flex', alignItems: 'center', columnGap: '12px', flexWrap: 'wrap' },
  warn: { marginTop: '10px' },
})

/** "No Alvanista": o que o cartão trouxe; cada linha some quando o dado falta. */
export function AlvanistaCardBlock({ card }: { card: AlvanistaCard }) {
  const { t, i18n } = useTranslation()
  const s = useStyles()
  const num = (n: number) => n.toLocaleString(i18n.language)
  const collection = card.proofs?.collection
  const trophies = card.proofs?.trophies
  const ledger = card.ledger
  const tiles: { key: string; value: string; label: string; nets?: string[] }[] = []
  if (collection)
    tiles.push({
      key: 'collection',
      value: num(collection.games),
      label: collection.platforms
        ? t('profilePage.alvaCollectionPlatforms', { count: collection.platforms })
        : t('profilePage.alvaCollection'),
    })
  if (trophies)
    tiles.push({
      key: 'trophies',
      value: num(trophies.count),
      label: t('profilePage.alvaTrophies'),
      nets: trophies.networks,
    })
  if (ledger?.hours != null)
    tiles.push({ key: 'hours', value: `${num(ledger.hours)} h`, label: t('profilePage.alvaHours') })
  if (ledger?.finished != null)
    tiles.push({ key: 'finished', value: num(ledger.finished), label: t('profilePage.alvaFinished') })
  if (ledger?.checkins != null)
    tiles.push({ key: 'checkins', value: num(ledger.checkins), label: t('profilePage.alvaCheckins') })
  if (ledger?.gamers != null)
    tiles.push({ key: 'gamers', value: num(ledger.gamers), label: t('profilePage.alvaGamers') })
  const recent = (card.badges?.recent ?? []).slice(0, 4)
  const total = card.badges?.count ?? 0
  const now = card.playing_now

  return (
    <div className={s.card} data-testid="profile-alvanista">
      <div className={s.title}>
        <img className={s.symbol} src={symbol} alt="" aria-hidden draggable={false} />
        <SectionHeader as="h3" title={t('profilePage.alvaTitle')} />
      </div>
      {tiles.length > 0 && (
        <div className={s.grid}>
          {tiles.map((x) => (
            <div key={x.key} data-tile={x.key}>
              <div className={s.value} data-value>
                {x.value}
              </div>
              <div className={s.label}>{x.label}</div>
              {x.nets && x.nets.length > 0 && (
                <div className={s.nets}>
                  {x.nets.map((n) => (
                    <span key={n} className={s.net}>
                      {n}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {(recent.length > 0 || total > 0) && (
        <div className={s.badges} data-testid="profile-alvanista-badges">
          {recent.map((b) => {
            const name = pickText(b.names, i18n.language) ?? b.name
            return <img key={b.icon_url} className={s.badge} src={b.icon_url} alt={name} title={name} loading="lazy" />
          })}
          {total > 0 && <span className={s.more}>{t('profilePage.alvaBadges', { count: total })}</span>}
        </div>
      )}
      {now && (
        <div className={s.now} data-testid="profile-alvanista-now">
          {now.cover_url ? <img className={s.nowCover} src={now.cover_url} alt="" loading="lazy" /> : null}
          <div>
            <div className={s.label}>{t('profilePage.alvaPlaying')}</div>
            <div className={s.nowTitle}>{now.title}</div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Sem conexão: o convite. O botão só inicia o fluxo; nada roda antes do clique. */
export function AlvanistaInvite() {
  const { t } = useTranslation()
  const s = useStyles()
  const { connect, cancel, connecting, outcome } = useAlvanistaConnect()
  return (
    <div className={s.card} data-testid="profile-alvanista-invite">
      <div className={s.promo}>
        <img className={s.promoSymbol} src={symbol} alt="" aria-hidden draggable={false} />
        <div>
          <p className={s.promoText}>{t('profilePage.alvaInvite')}</p>
          {connecting ? (
            <div className={s.waiting}>
              <Spinner size="tiny" />
              <span>{t('alvanista.waiting')}</span>
              <Button appearance="secondary" onClick={cancel}>
                {t('alvanista.cancel')}
              </Button>
            </div>
          ) : (
            <AlvanistaButton onClick={connect} />
          )}
        </div>
      </div>
      {outcome && (
        <MessageBar intent="warning" className={s.warn}>
          <MessageBarBody>{t(`alvanista.${outcome}`)}</MessageBarBody>
        </MessageBar>
      )}
    </div>
  )
}
