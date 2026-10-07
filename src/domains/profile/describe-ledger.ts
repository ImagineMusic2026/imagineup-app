import { isSameDay, subDays } from 'date-fns';
import {
  Award,
  Flame,
  Gift,
  Heart,
  MessageCircle,
  Ticket,
  Undo2,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react-native';

import type { IconTileTone } from '@/components/icon-tile';
import { t, type TranslationKey } from '@/i18n';
import { formatLongDate, formatTime, formatWeekdayDayMonth, toDate } from '@/utils/date';
import { formatPointsDelta, formatPointsSpoken } from '@/utils/number';

import type { LedgerEntry } from './types';

/**
 * O contexto da linha: a central, o título guardado no lançamento (o da
 * missão e, desde o bloco 10, o da recompensa no resgate e na devolução) ou
 * nada.
 */
type LedgerContext = 'artist' | 'subject' | 'none';

interface SourceSpec {
  title: TranslationKey;
  icon: LucideIcon;
  tone: IconTileTone;
  context: LedgerContext;
}

/**
 * De onde veio cada lançamento (22.12), pela regra de cor do app: rosa para
 * ação, lima para pontos e convite, ciano para shows. Origem que o app não
 * conhece cai em "Pontos".
 */
const SOURCES: Readonly<Record<string, SourceSpec>> = {
  like: { title: 'ledger.sources.like', icon: Heart, tone: 'action', context: 'artist' },
  comment: {
    title: 'ledger.sources.comment',
    icon: MessageCircle,
    tone: 'action',
    context: 'artist',
  },
  rsvp: { title: 'ledger.sources.rsvp', icon: Ticket, tone: 'events', context: 'artist' },
  central_join: {
    title: 'ledger.sources.central_join',
    icon: UserPlus,
    tone: 'action',
    context: 'artist',
  },
  mission: { title: 'ledger.sources.mission', icon: Flame, tone: 'points', context: 'subject' },
  invite_visit: {
    title: 'ledger.sources.invite_visit',
    icon: Users,
    tone: 'points',
    context: 'none',
  },
  invite_signup: {
    title: 'ledger.sources.invite_signup',
    icon: Users,
    tone: 'points',
    context: 'none',
  },
  redeem: { title: 'ledger.sources.redeem', icon: Gift, tone: 'action', context: 'subject' },
  // A devolução do resgate recusado (bloco 10): volta ao saldo, em lima.
  redeem_refund: {
    title: 'ledger.sources.redeem_refund',
    icon: Undo2,
    tone: 'points',
    context: 'subject',
  },
  adjustment: {
    title: 'ledger.sources.adjustment',
    icon: Award,
    tone: 'points',
    context: 'none',
  },
  seed: { title: 'ledger.sources.seed', icon: Award, tone: 'points', context: 'none' },
};

const OTHER: SourceSpec = {
  title: 'ledger.sources.other',
  icon: Award,
  tone: 'points',
  context: 'none',
};

export function ledgerSource(entry: Pick<LedgerEntry, 'source'>): SourceSpec {
  return SOURCES[entry.source] ?? OTHER;
}

/**
 * A linha aparece? O ajuste só de central (saldo, XP e temporada em 0, que só
 * o seed e o ajuste da equipe fazem) não diz nada ao fã: fica de fora.
 */
export function isVisibleLedgerEntry(entry: LedgerEntry): boolean {
  return entry.points !== 0 || entry.xpDelta !== 0 || entry.seasonDelta !== 0;
}

/** O valor da linha: o que o saldo mexeu; no ajuste sem saldo, o XP ou a temporada. */
export function ledgerValue(entry: LedgerEntry): number {
  return entry.points || entry.xpDelta || entry.seasonDelta;
}

/**
 * O contexto: a central (curtida, comentário, presença, entrada) ou o título
 * guardado no lançamento (a missão, a recompensa do resgate e da devolução).
 */
export function ledgerContext(entry: LedgerEntry): string | null {
  const { context } = ledgerSource(entry);
  if (context === 'artist') return entry.artistName ?? null;
  if (context === 'subject') return entry.subjectTitle ?? null;
  return null;
}

/** "Hoje", "Ontem" ou "sex., 3 out", no fuso do aparelho. */
export function ledgerDayLabel(createdAt: string, now: Date): string {
  const date = toDate(createdAt);
  if (isSameDay(date, now)) return t('ledger.days.today');
  if (isSameDay(date, subDays(now, 1))) return t('ledger.days.yesterday');
  return formatWeekdayDayMonth(date);
}

/** "hoje às 22:31", "ontem às 9:05", "em 3 de outubro às 12:00": para o leitor de tela. */
function ledgerWhen(createdAt: string, now: Date): string {
  const date = toDate(createdAt);
  const time = formatTime(date);
  if (isSameDay(date, now)) return t('ledger.when.today', { time });
  if (isSameDay(date, subDays(now, 1))) return t('ledger.when.yesterday', { time });
  return t('ledger.when.other', { date: formatLongDate(date), time });
}

/** "Curta 5 posts do Nenho · 22:31", embaixo do título; sem contexto, só a hora. */
export function ledgerMeta(entry: LedgerEntry): string {
  const context = ledgerContext(entry);
  const time = formatTime(entry.createdAt);
  return context ? t('ledger.rowMeta', { context, time }) : time;
}

/** "+10", "-1.000", à direita. */
export function ledgerValueText(entry: LedgerEntry): string {
  return formatPointsDelta(ledgerValue(entry));
}

/** Ganho em lima; resgate e ajuste negativo no texto padrão. */
export function isLedgerGain(entry: LedgerEntry): boolean {
  return ledgerValue(entry) > 0;
}

/**
 * A linha num rótulo só: "Missão concluída, Curta 5 posts do Nenho, mais 10
 * pontos, hoje às 22:31."
 */
export function ledgerRowLabel(entry: LedgerEntry, now: Date): string {
  const value = ledgerValue(entry);
  const points = t(value < 0 ? 'ledger.pointsLoss' : 'ledger.pointsGain', {
    points: formatPointsSpoken(Math.abs(value)),
  });
  const title = t(ledgerSource(entry).title);
  const when = ledgerWhen(entry.createdAt, now);
  const context = ledgerContext(entry);
  return context
    ? t('ledger.rowLabel', { title, context, points, when })
    : t('ledger.rowLabelNoContext', { title, points, when });
}

/** Célula da lista do extrato: a sobrelinha do dia ou a linha do lançamento. */
export type LedgerListItem =
  { type: 'day'; key: string; label: string } | { type: 'entry'; key: string; entry: LedgerEntry };

/**
 * As linhas visíveis, do mais novo ao mais antigo, com a sobrelinha a cada dia
 * novo (no fuso do aparelho).
 */
export function buildLedgerItems(entries: readonly LedgerEntry[], now: Date): LedgerListItem[] {
  const items: LedgerListItem[] = [];
  let lastDay: string | null = null;
  for (const entry of entries) {
    if (!isVisibleLedgerEntry(entry)) continue;
    const label = ledgerDayLabel(entry.createdAt, now);
    if (label !== lastDay) {
      items.push({ type: 'day', key: `day-${entry.id}`, label });
      lastDay = label;
    }
    items.push({ type: 'entry', key: entry.id, entry });
  }
  return items;
}
