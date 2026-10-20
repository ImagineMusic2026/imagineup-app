import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ChipGroup, type ChipItem } from '@/components/chip';
import { BackButton } from '@/components/header';
import { SheetGrabber } from '@/components/sheet-grabber';
import { Text } from '@/components/text';
import { SuspensionContact } from '@/domains/profile';
import { useIsOnline } from '@/hooks/use-is-online';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t, type TranslationKey } from '@/i18n';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { colors, spacing } from '@/theme';

import { fanClubErrorText } from '../describe';
import { useCachedFanClubPost, useReportFanClubPostMutation } from '../queries';
import type { FanClubReportReason } from '../types';

/** Aberta a frio (link), sem tela embaixo, a sheet volta para o início. */
function closeSheet(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

type ReasonChoice = FanClubReportReason | 'none';

// Os motivos de hoje mais "Uso indevido de imagem", só nas publicações de
// fã-clube (decisão 18). "Sem motivo" manda null.
const REASON_ITEMS: readonly ChipItem<ReasonChoice>[] = [
  { value: 'none', label: t('post.moderation.reasons.none') },
  { value: 'image_misuse', label: t('fanClub.report.imageMisuse') },
  { value: 'spam', label: t('post.moderation.reasons.spam') },
  { value: 'offensive', label: t('post.moderation.reasons.offensive') },
  { value: 'harassment', label: t('post.moderation.reasons.harassment') },
  { value: 'other', label: t('post.moderation.reasons.other') },
];

/** O pedido que falhou por último, com o link "Escrever para a equipe" na conta suspensa. */
type Failure = { key: TranslationKey; contact: boolean } | null;

/**
 * Sheet "Denunciar publicação" (`/denunciar-publicacao/[publicacaoId]`, 34.9,
 * itens 7 e 9), aberta pelo Denunciar das publicações da página e da Início,
 * no molde da "Denunciar perfil": o título com o "×", o que a equipe faz, os
 * motivos numa fileira de escolha única e "Enviar denúncia". A publicação vem
 * das páginas já carregadas, lida na abertura; aberta a frio, sem ela, a sheet
 * fecha (nada do fã-clube abre antes da trava).
 *
 * Não é otimista: o botão fica carregando até o servidor responder, desligado
 * sem internet, e o voltar fica preso (`useStayOnScreen`). Sucesso (os dois
 * status, `reported` e `already_reported`, com a mesma frase): fecha e
 * anuncia, com o toque de sucesso. Erro: fica, com o aviso acima do botão,
 * anunciado, e o toque de erro (a publicação que saiu do ar, a conta suspensa
 * com o link, o teto, o ritmo ou a genérica). A nova tentativa depois de uma
 * falha incerta leva a mesma chave, e a denúncia não sai em dobro.
 */
export function ReportFanClubPostSheetScreen() {
  const params = useLocalSearchParams<{ publicacaoId: string }>();
  const postId = typeof params.publicacaoId === 'string' ? params.publicacaoId : '';
  const post = useCachedFanClubPost(postId);
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const [standalone] = useState(() => !router.canGoBack());
  const [reason, setReason] = useState<ReasonChoice>('none');
  const [failure, setFailure] = useState<Failure>(null);
  const report = useReportFanClubPostMutation();
  useStayOnScreen(report.isPending);

  // Aberta a frio (sem a publicação no cache): não há o que mostrar.
  useEffect(() => {
    if (!post) closeSheet();
  }, [post]);

  if (!post) return null;

  const run = (): void => {
    setFailure(null);
    report.mutate(
      { postId: post.id, reason: reason === 'none' ? null : reason },
      {
        onSuccess: () => {
          haptics.trigger('success');
          closeSheet();
          AccessibilityInfo.announceForAccessibility(t('fanClub.report.sent'));
        },
        onError: (error) => {
          const refusal = actionRefusal(error, 'clubReport');
          const key = fanClubErrorText(error)?.key ?? refusal.key;
          setFailure({ key, contact: refusal.type === 'suspended' });
          haptics.trigger('error');
          AccessibilityInfo.announceForAccessibility(t(key));
        },
      },
    );
  };

  return (
    <View style={styles.root} testID="fan-club-report-sheet">
      {standalone ? null : <SheetGrabber />}
      <View style={[styles.header, standalone && { paddingTop: insets.top + spacing.xs }]}>
        <Text variant="titleHeader" accessibilityRole="header" style={styles.title}>
          {t('fanClub.report.title')}
        </Text>
        <BackButton variant="close" onPress={closeSheet} disabled={report.isPending} />
      </View>
      <View style={[styles.body, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <Text variant="body" color={colors.textSecondary}>
          {t('fanClub.report.body')}
        </Text>
        <ChipGroup
          items={REASON_ITEMS}
          value={reason}
          onChange={setReason}
          style={styles.reasons}
          testID="fan-club-report-reasons"
        />
        <View style={styles.actions}>
          {failure ? (
            <View>
              <Text variant="caption" color={colors.danger} style={styles.error}>
                {t(failure.key)}
              </Text>
              {failure.contact ? <SuspensionContact align="center" /> : null}
            </View>
          ) : null}
          <Button
            label={t('fanClub.report.submit')}
            onPress={run}
            loading={report.isPending}
            disabled={!online}
            haptic="confirm"
            testID="fan-club-report-submit"
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
  // A fileira vai de ponta a ponta da sheet e rola por baixo da margem, como
  // as outras fileiras de chips do app (o gutter fica dentro dela).
  reasons: {
    marginTop: spacing.md,
    marginHorizontal: -spacing.gutter,
  },
  actions: {
    marginTop: spacing.sectionTop,
    gap: spacing.listGap,
  },
  error: {
    textAlign: 'center',
  },
});
