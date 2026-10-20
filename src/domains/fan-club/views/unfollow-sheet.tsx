import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { BackButton } from '@/components/header';
import { SheetGrabber } from '@/components/sheet-grabber';
import { Text } from '@/components/text';
import { useIsOnline } from '@/hooks/use-is-online';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t, type TranslationKey } from '@/i18n';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { colors, spacing } from '@/theme';

import { useCachedFanClub, useUnfollowFanClubMutation } from '../queries';

/** Aberta a frio (link), sem tela embaixo, a sheet volta para o início. */
function closeSheet(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * Sheet "Deixar de seguir?" (`/deixar-de-seguir/[clubeId]`, 34.9, itens 7 e
 * 10), aberta pelo "Seguindo" da página e pelo "Deixar de seguir" de
 * "Fã-clubes que sigo", no visual da "Sair da central": o título com o "×", o
 * texto (as publicações saem da Início, e o fã continua na central do
 * artista) e dois botões no pé. O fã-clube vem do cache da página ou da lista,
 * lido na abertura; aberta a frio, sem ele, a sheet fecha (nada do fã-clube
 * abre antes da trava).
 *
 * Não é otimista: o botão fica carregando até o servidor responder, desligado
 * sem internet, e o voltar fica preso (`useStayOnScreen`). No sucesso, fecha e
 * anuncia; no erro, fica, com o aviso acima dos botões, anunciado, e o toque
 * de erro. Deixar de seguir nunca recusa: o erro é a rede ou o ritmo.
 */
export function UnfollowFanClubSheetScreen() {
  const params = useLocalSearchParams<{ clubeId: string }>();
  const clubId = typeof params.clubeId === 'string' ? params.clubeId : '';
  const club = useCachedFanClub(clubId);
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const [standalone] = useState(() => !router.canGoBack());
  const [failure, setFailure] = useState<TranslationKey | null>(null);
  const unfollow = useUnfollowFanClubMutation();
  useStayOnScreen(unfollow.isPending);

  // Aberta a frio (sem o fã-clube no cache): não há o que mostrar.
  useEffect(() => {
    if (!club) closeSheet();
  }, [club]);

  if (!club) return null;
  const name = club.name ?? t('fanClub.follows.unavailableName');

  const run = (): void => {
    setFailure(null);
    unfollow.mutate(club.id, {
      onSuccess: () => {
        haptics.trigger('success');
        closeSheet();
        AccessibilityInfo.announceForAccessibility(t('fanClub.unfollow.done', { name }));
      },
      onError: (error) => {
        const key = actionRefusal(error, 'clubUnfollow').key;
        setFailure(key);
        haptics.trigger('error');
        AccessibilityInfo.announceForAccessibility(t(key));
      },
    });
  };

  return (
    <View style={styles.root} testID="fan-club-unfollow-sheet">
      {standalone ? null : <SheetGrabber />}
      <View style={[styles.header, standalone && { paddingTop: insets.top + spacing.xs }]}>
        <Text variant="titleHeader" accessibilityRole="header" style={styles.title}>
          {t('fanClub.unfollow.title')}
        </Text>
        <BackButton variant="close" onPress={closeSheet} disabled={unfollow.isPending} />
      </View>
      <View style={[styles.body, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <Text variant="body" color={colors.textSecondary}>
          {t('fanClub.unfollow.body', { artist: club.artistName })}
        </Text>
        <View style={styles.actions}>
          {failure ? (
            <Text variant="caption" color={colors.danger} style={styles.error}>
              {t(failure)}
            </Text>
          ) : null}
          <Button
            label={t('fanClub.unfollow.confirm')}
            onPress={run}
            loading={unfollow.isPending}
            disabled={!online}
            haptic="confirm"
            testID="fan-club-unfollow-confirm"
          />
          <Button
            label={t('fanClub.unfollow.cancel')}
            variant="ghost"
            onPress={closeSheet}
            disabled={unfollow.isPending}
            testID="fan-club-unfollow-cancel"
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
    paddingTop: spacing.sm,
  },
  actions: {
    marginTop: spacing.sectionTop,
    gap: spacing.listGap,
  },
  error: {
    textAlign: 'center',
  },
});
