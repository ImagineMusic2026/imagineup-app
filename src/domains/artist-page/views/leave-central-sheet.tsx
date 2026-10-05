import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { BackButton } from '@/components/header';
import { SheetGrabber } from '@/components/sheet-grabber';
import { Text } from '@/components/text';
import { useLeaveCentralMutation } from '@/domains/artists';
import { useIsOnline } from '@/hooks/use-is-online';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { colors, spacing } from '@/theme';

/** Aberta a frio (link), sem tela embaixo, a sheet volta para o início. */
function closeSheet(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * Sheet "Sair da central" (provisória, UP-48: o lugar definitivo depende do
 * menu "mais"). Abre pelo "Na central" da página do artista (1d), no visual do
 * "Gerar meu link": o título com o "×", o texto e dois botões no pé. Sair não
 * tira pontos, e entrar de novo não rende a entrada outra vez; o texto diz
 * isso sem o nome da central, para a sheet não depender de a página ter
 * carregado, e sem falar do mural (o mural de exemplo mostra as centrais do
 * protótipo para qualquer fã até o bloco 6).
 *
 * Não é otimista: o botão fica "carregando" até o servidor responder. No
 * sucesso, a sheet fecha, avisa e a 1d volta a "Entrar na central"; no erro,
 * fica, com o aviso acima dos botões (também anunciado) e o toque de erro. Sem
 * internet, "Sair da central" fica desligado. Enquanto o pedido vai, o voltar
 * do Android e o gesto do iOS ficam presos (`useStayOnScreen`), como no
 * resgate; o arrasto da sheet no Android não trava, e a resposta que chega
 * depois dele não navega (`useLeaveCentralMutation`).
 */
export function LeaveCentralSheetScreen() {
  const params = useLocalSearchParams<{ artistaId: string }>();
  const artistId = typeof params.artistaId === 'string' ? params.artistaId : '';
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  // Aberta a frio (link), a sheet é a única tela da pilha e ocupa a tela toda:
  // sem puxador, e o topo desce abaixo da barra de status.
  const [standalone] = useState(() => !router.canGoBack());
  const leave = useLeaveCentralMutation(artistId, {
    onLeft: () => {
      closeSheet();
      AccessibilityInfo.announceForAccessibility(t('artist.leave.left'));
    },
    onError: () => {
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t('artist.leave.error'));
    },
  });
  useStayOnScreen(leave.isPending);

  return (
    <View style={styles.root}>
      {standalone ? null : <SheetGrabber />}
      <View style={[styles.header, standalone && { paddingTop: insets.top + spacing.xs }]}>
        <Text variant="titleHeader" accessibilityRole="header" style={styles.title}>
          {t('artist.leave.title')}
        </Text>
        <BackButton variant="close" onPress={closeSheet} disabled={leave.isPending} />
      </View>
      <View style={[styles.body, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <Text variant="body" color={colors.textSecondary}>
          {t('artist.leave.body')}
        </Text>
        <View style={styles.actions}>
          {leave.isError ? (
            <Text variant="caption" color={colors.danger} style={styles.error}>
              {t('artist.leave.error')}
            </Text>
          ) : null}
          <Button
            label={t('artist.leave.confirm')}
            onPress={leave.leave}
            loading={leave.isPending}
            disabled={!online || !artistId}
            haptic="confirm"
            testID="leave-central-confirm"
          />
          <Button
            label={t('artist.leave.cancel')}
            variant="ghost"
            onPress={closeSheet}
            disabled={leave.isPending}
            testID="leave-central-cancel"
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
  // Abaixo do puxador da sheet. O "×" fica colado ao fim do alvo, na mesma
  // coluna do conteúdo.
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
