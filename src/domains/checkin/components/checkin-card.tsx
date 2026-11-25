import { Check, Flame } from 'lucide-react-native';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { IconTile } from '@/components/icon-tile';
import { Text } from '@/components/text';
import { t, type TranslationKey } from '@/i18n';
import { borderWidths, colors, fonts, layout, radii, spacing, tints } from '@/theme';
import { withAlpha } from '@/utils/color';

import {
  actionLabel,
  actionText,
  checkinCells,
  checkinSummary,
  doneCycleDays,
  doneFooterLabel,
  doneMeta,
  endsInText,
  streakText,
  trackLabel,
  type CheckinCell,
  type PointsText,
} from '../describe-checkin';
import type { CheckinState } from '../types';

// A chama de 20 ao lado da sequência; o check de 14 com traço 3, o do selo das missões.
const FLAME_SIZE = 20;
const FLAME_STROKE = 2;
const CHECK_SIZE = 14;
const CHECK_STROKE = 3;
// O "+15" e o "Dia 7" encolhem até aqui antes de cortar, numa célula estreita.
// O servidor e o painel só aceitam de 1 a 999 por dia do ciclo: a célula nunca
// precisa desenhar quatro algarismos.
const MIN_FONT_SCALE = 0.7;

/** Um dia da trilha: o quadro (o check do dia feito ou o "+N") e, embaixo, "Hoje" ou "Dia 5". */
function TrackCell({ cell }: { cell: CheckinCell }) {
  const done = cell.status === 'done';
  const today = cell.status === 'today';

  return (
    <View style={styles.cell}>
      <View
        testID={`checkin-cell-${cell.day}`}
        style={[styles.box, done ? styles.boxDone : today ? styles.boxToday : null]}
      >
        {done ? (
          <Icon icon={Check} size={CHECK_SIZE} color={colors.onPoints} strokeWidth={CHECK_STROKE} />
        ) : (
          <Text
            variant="chipSmall"
            color={today ? colors.points : colors.textSecondary}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={MIN_FONT_SCALE}
          >
            {cell.value}
          </Text>
        )}
      </View>
      <Text
        variant="labelTiny"
        color={today ? colors.text : colors.textMuted}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={MIN_FONT_SCALE}
        style={styles.cellLabel}
      >
        {cell.label}
      </Text>
    </View>
  );
}

/**
 * A trilha do ciclo, uma célula por valor que o servidor mandou: os dias
 * feitos em lima cheio com o check, o de hoje com o contorno lima e o "+N" em
 * lima, e os seguintes apagados. Um elemento só para o leitor, lido como
 * progresso: "Dia 5 de 7. O check-in de hoje vale 5 pontos. O dia 7 vale 15
 * pontos."
 */
function CheckinTrack({ state }: { state: CheckinState }) {
  const cells = checkinCells(state);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={trackLabel(state)}
      accessibilityValue={{ min: 0, max: cells.length, now: doneCycleDays(state) }}
      testID="checkin-track"
      style={styles.track}
    >
      {cells.map((cell) => (
        <TrackCell key={cell.day} cell={cell} />
      ))}
    </View>
  );
}

/** Um valor em lima no meio do texto: "+5 hoje", "Amanhã vale +6". */
function PointsSpan({ text }: { text: PointsText }) {
  return (
    <>
      {text.before}
      <Text variant="caption" style={styles.points}>
        {text.points}
      </Text>
      {text.after}
    </>
  );
}

/**
 * O pé do card com o check-in de hoje feito, no lugar do botão: o check no
 * quadro lima, "Check-in de hoje feito" e, embaixo, quanto rendeu e quanto
 * vale o de amanhã, com os valores em lima. Um elemento só para o leitor:
 * "Check-in de hoje feito. Rendeu 5 pontos. Amanhã vale 6 pontos."
 */
function CheckinDoneFooter({ state }: { state: CheckinState }) {
  const { earned, next } = doneMeta(state);

  return (
    <View
      accessible
      accessibilityLabel={doneFooterLabel(state)}
      testID="checkin-done"
      style={styles.done}
    >
      <IconTile icon={Check} tone="points" />
      <View style={styles.doneTexts}>
        <Text variant="label">{t('checkin.done.today')}</Text>
        {earned || next ? (
          <Text variant="caption" color={colors.textMuted} style={styles.doneMeta}>
            {earned ? <PointsSpan text={earned} /> : null}
            {earned && next ? ' · ' : null}
            {next ? <PointsSpan text={next} /> : null}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export interface CheckinCardProps {
  state: CheckinState;
  /** Relógio do "Termina em 4 h". */
  now: Date;
  /** Sem internet, o botão fica desligado: o check-in não entra na fila offline. */
  online: boolean;
  /** O pedido está indo. */
  pending: boolean;
  /** A frase da última falha do toque, embaixo do botão. */
  failure: TranslationKey | null;
  onCheckin: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Card do check-in de hoje, que o ícone do calendário abre. Escuro, na regra
 * de cor do app: rosa para a ação (o botão), lima só para os pontos e para os
 * dias feitos. O card lima da missão do dia, logo embaixo, segue o único bloco
 * lima da Início. Não é pressável: tem o botão dentro.
 *
 * O selo com o prazo e, embaixo, a chama com a sequência são lidos juntos e
 * abrem o card como cabeçalho ("Check-in diário. 4 dias seguidos. Termina em
 * 4 horas."), como o topo do card da missão do dia; depois vêm a trilha, um
 * elemento só, e o botão "Fazer check-in +5", com o valor por extenso no
 * rótulo. Sem internet, o botão fica desligado e diz o motivo na dica e
 * embaixo dele; a falha do toque aparece no mesmo lugar (o anúncio dela é do
 * hook). Com o de hoje feito, o prazo sai, o dia entra na trilha como feito e
 * o pé do "Check-in de hoje feito" toma o lugar do botão.
 */
export function CheckinCard({
  state,
  now,
  online,
  pending,
  failure,
  onCheckin,
  style,
}: CheckinCardProps) {
  const done = state.checkedInToday;
  const endsIn = done ? null : endsInText(state, now);
  // Sem rede, o motivo do botão desligado vem antes da falha de antes.
  const message = !online ? t('checkin.offline') : failure ? t(failure) : null;

  return (
    <View testID="checkin-card" style={[styles.card, style]}>
      <View accessible accessibilityRole="header" accessibilityLabel={checkinSummary(state, now)}>
        <View style={styles.topRow}>
          <Text variant="overline" color={colors.textMuted}>
            {t('checkin.badge')}
          </Text>
          {endsIn ? (
            <Text variant="caption" color={colors.textMuted}>
              {endsIn}
            </Text>
          ) : null}
        </View>
        <View style={styles.streak}>
          <Icon icon={Flame} size={FLAME_SIZE} color={colors.points} strokeWidth={FLAME_STROKE} />
          <Text variant="titleEvent" style={styles.streakText}>
            {streakText(state.streak)}
          </Text>
        </View>
      </View>
      <CheckinTrack state={state} />
      {done ? (
        <CheckinDoneFooter state={state} />
      ) : (
        <>
          <Button
            label={actionText(state)}
            variant="primary"
            size="md"
            // Dentro do card com borda, o brilho rosa do botão sairia cortado no recorte.
            glow={false}
            loading={pending}
            disabled={!online}
            haptic="confirm"
            onPress={onCheckin}
            accessibilityLabel={actionLabel(state)}
            // Desligado sem rede: o leitor ouve o motivo no próprio botão, antes do aviso embaixo.
            accessibilityHint={t(online ? 'checkin.actionHint' : 'checkin.offline')}
            testID="checkin-action"
            style={styles.action}
          />
          {message ? (
            <Text
              variant="caption"
              color={online && failure ? colors.danger : colors.textMuted}
              testID="checkin-message"
              style={styles.message}
            >
              {message}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.gutter,
    padding: spacing.lg,
    borderRadius: radii.xxl,
    borderWidth: borderWidths.default,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  // O selo à esquerda e o prazo à direita, como no topo do card da missão do
  // dia; com a fonte grande, o prazo desce para baixo do selo em vez de espremer.
  topRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.md,
    rowGap: spacing.xxs,
  },
  // A chama e a sequência na linha de baixo, com a largura toda: "Comece sua
  // sequência" cabe num aparelho de 360 sem disputar espaço com o prazo.
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.metaGap,
  },
  streakText: {
    flexShrink: 1,
  },
  track: {
    flexDirection: 'row',
    gap: spacing.metaGap,
    marginTop: spacing.cardPadding,
  },
  cell: {
    flex: 1,
    minWidth: 0,
  },
  // Os dias por vir: o vidro apagado, com o "+N" em texto secundário.
  box: {
    height: layout.iconTile,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxs,
    borderRadius: radii.xs,
    borderWidth: borderWidths.default,
    borderColor: colors.border,
    backgroundColor: colors.glass,
  },
  boxDone: {
    borderColor: colors.points,
    backgroundColor: colors.points,
  },
  boxToday: {
    borderWidth: borderWidths.strong,
    borderColor: colors.points,
    backgroundColor: withAlpha(colors.points, tints.faint.fill),
  },
  cellLabel: {
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  action: {
    marginTop: spacing.cardPadding,
  },
  message: {
    marginTop: spacing.sm,
  },
  // O pé do "feito" na altura do botão que ele troca: o quadro e os dois textos.
  done: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.itemGap,
    marginTop: spacing.cardPadding,
  },
  doneTexts: {
    flex: 1,
    minWidth: 0,
  },
  doneMeta: {
    marginTop: spacing.metaGap,
  },
  points: {
    fontFamily: fonts.manropeBold,
    color: colors.points,
  },
});
