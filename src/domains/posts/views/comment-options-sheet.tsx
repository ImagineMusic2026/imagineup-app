import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ChipGroup, type ChipItem } from '@/components/chip';
import { BackButton } from '@/components/header';
import { SheetGrabber } from '@/components/sheet-grabber';
import { Text } from '@/components/text';
import { useIsOnline } from '@/hooks/use-is-online';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { colors, spacing } from '@/theme';

import { useBlockFanMutation, useCachedComment, useReportCommentMutation } from '../queries';
import type { CommentReportReason } from '../types';

/** Aberta a frio (link), sem tela embaixo, a sheet volta para o início. */
function closeSheet(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

type ReasonChoice = CommentReportReason | 'none';

const REASONS: readonly ReasonChoice[] = ['none', 'spam', 'offensive', 'harassment', 'other'];

const REASON_ITEMS: readonly ChipItem<ReasonChoice>[] = REASONS.map((value) => ({
  value,
  label: t(`post.moderation.reasons.${value}`),
}));

/** Qual pedido falhou por último: o aviso acima dos botões diz o dele. */
type Failure = 'report' | 'block' | null;

/**
 * Sheet "Opções do comentário" (moderação provisória, UP-48): abre pelo botão
 * de três pontos na linha do comentário de outro fã, no visual das outras
 * sheets ("Gerar meu link", "Sair da central"). Denunciar, com o motivo
 * opcional numa fileira de escolha única ("Sem motivo" manda null), e
 * bloquear o autor, cujos comentários somem para o fã em todos os posts, sem
 * ele ficar sabendo. O conteúdo é fixo, para a altura da sheet não mudar; o
 * comentário vem do cache da lista do post (aberta a frio, sem ele, a sheet
 * fecha).
 *
 * Não é otimista: o botão tocado fica "carregando" até o servidor responder,
 * os dois ficam desligados sem internet e enquanto um pedido vai, e o voltar
 * fica preso (`useStayOnScreen`). Sucesso: fecha e anuncia, com o toque de
 * sucesso. Erro: fica, com o aviso acima dos botões, anunciado, e o toque de
 * erro. A resposta que chega com a sheet fechada só anuncia (os hooks
 * conferem se ela está montada).
 */
export function CommentOptionsSheetScreen() {
  const params = useLocalSearchParams<{ comentarioId: string; post: string }>();
  const commentId = typeof params.comentarioId === 'string' ? params.comentarioId : '';
  const postId = typeof params.post === 'string' ? params.post : '';
  const comment = useCachedComment(postId, commentId);
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const [standalone] = useState(() => !router.canGoBack());
  const [reason, setReason] = useState<ReasonChoice>('none');
  const [failure, setFailure] = useState<Failure>(null);
  const name = comment?.authorName ?? '';

  const fail = (which: Exclude<Failure, null>, message: string) => {
    setFailure(which);
    haptics.trigger('error');
    AccessibilityInfo.announceForAccessibility(message);
  };

  const report = useReportCommentMutation(postId, commentId, {
    onDone: () => {
      haptics.trigger('success');
      closeSheet();
      AccessibilityInfo.announceForAccessibility(t('post.moderation.reported'));
    },
    onError: () => fail('report', t('post.moderation.reportError')),
  });
  const block = useBlockFanMutation(comment?.authorId ?? '', {
    onDone: () => {
      haptics.trigger('success');
      closeSheet();
      AccessibilityInfo.announceForAccessibility(t('post.moderation.blocked', { name }));
    },
    onError: () => fail('block', t('post.moderation.blockError')),
  });
  const busy = report.isPending || block.isPending;
  useStayOnScreen(busy);

  // Aberta a frio (sem a lista do post no cache): não há o que mostrar.
  useEffect(() => {
    if (!comment) closeSheet();
  }, [comment]);

  if (!comment) return null;

  const error =
    failure === 'report'
      ? t('post.moderation.reportError')
      : failure === 'block'
        ? t('post.moderation.blockError')
        : null;

  return (
    <View style={styles.root}>
      {standalone ? null : <SheetGrabber />}
      <View style={[styles.header, standalone && { paddingTop: insets.top + spacing.xs }]}>
        <Text variant="titleHeader" accessibilityRole="header" style={styles.title}>
          {t('post.moderation.title', { name })}
        </Text>
        <BackButton variant="close" onPress={closeSheet} disabled={busy} />
      </View>
      <View style={[styles.body, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <Text variant="headingSection" accessibilityRole="header">
          {t('post.moderation.reportSection')}
        </Text>
        <Text variant="body" color={colors.textSecondary} style={styles.text}>
          {t('post.moderation.reportBody')}
        </Text>
        <ChipGroup
          items={REASON_ITEMS}
          value={reason}
          onChange={setReason}
          style={styles.reasons}
          testID="comment-report-reasons"
        />
        <Text variant="headingSection" accessibilityRole="header" style={styles.section}>
          {t('post.moderation.blockSection')}
        </Text>
        <Text variant="body" color={colors.textSecondary} style={styles.text}>
          {t('post.moderation.blockBody', { name })}
        </Text>
        <View style={styles.actions}>
          {error ? (
            <Text variant="caption" color={colors.danger} style={styles.error}>
              {error}
            </Text>
          ) : null}
          <Button
            label={t('post.moderation.report')}
            onPress={() => {
              setFailure(null);
              report.report(reason === 'none' ? null : reason);
            }}
            loading={report.isPending}
            disabled={!online || busy}
            haptic="confirm"
            testID="comment-report"
          />
          <Button
            label={t('post.moderation.block', { name })}
            variant="secondary"
            onPress={() => {
              setFailure(null);
              block.block();
            }}
            loading={block.isPending}
            disabled={!online || busy || !comment.authorId}
            haptic="confirm"
            testID="comment-block"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A sheet tem a altura do conteúdo (`fitToContents`): nada de `flex: 1` na raiz.
  root: {
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.gutter,
  },
  title: {
    flex: 1,
  },
  body: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.lg,
  },
  text: {
    marginTop: spacing.xs,
  },
  // A fileira vai de ponta a ponta da sheet e rola por baixo da margem, como
  // as outras fileiras de chips do app (o gutter fica dentro dela).
  reasons: {
    marginTop: spacing.md,
    marginHorizontal: -spacing.gutter,
  },
  section: {
    marginTop: spacing.sectionTop,
  },
  actions: {
    marginTop: spacing.sectionTop,
    gap: spacing.listGap,
  },
  error: {
    textAlign: 'center',
  },
});
