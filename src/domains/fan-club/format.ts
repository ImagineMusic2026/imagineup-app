import { t } from '@/i18n';
import { formatDate } from '@/utils/date';

import type { NextRound } from './entry';

/**
 * Um dia `AAAA-MM-DD` de São Paulo (o fim do Destaque, decisão 35) como
 * "25/10/2026", sem passar pelo `Date`: o `new Date('2026-10-25')` é a
 * meia-noite UTC, que no fuso do Brasil ainda é o dia anterior.
 */
export function formatDayKey(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/** A frase da próxima candidatura, na recusa e no fã-clube encerrado (34.9, item 4). */
export function nextRoundText(next: NextRound): string {
  switch (next.kind) {
    case 'now':
      return t('fanClub.state.againNow');
    case 'date': {
      const date = formatDate(next.date);
      return date
        ? t('fanClub.errors.refused.cooldown', { date })
        : t('fanClub.errors.refused.cooldownLater');
    }
    case 'roundsOver':
      return t('fanClub.errors.refused.tooManyRounds');
    case 'programClosed':
      return t('fanClub.errors.refused.applicationsClosed');
    case 'never':
      return t('fanClub.errors.refused.notAllowed');
  }
}
