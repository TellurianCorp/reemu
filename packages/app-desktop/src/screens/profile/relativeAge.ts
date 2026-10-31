/** "há 5 minutos", "agora": o instante (segundos Unix) contra `nowMs`. */
export function relativeAge(secs: number, nowMs: number, lang: string): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const diff = Math.max(0, Math.round(nowMs / 1000 - secs))
  if (diff < 60) return rtf.format(0, 'second')
  if (diff < 3600) return rtf.format(-Math.floor(diff / 60), 'minute')
  if (diff < 86400) return rtf.format(-Math.floor(diff / 3600), 'hour')
  return rtf.format(-Math.floor(diff / 86400), 'day')
}
