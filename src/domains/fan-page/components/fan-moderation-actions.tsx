import { router } from 'expo-router';
import { Ban, Flag } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { AccessibilityInfo, Alert, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { SectionLabel } from '@/components/section-label';
import { Text } from '@/components/text';
import { useBlockFanMutation, useUnblockFanMutation } from '@/domains/posts';
import type { FanPublicProfile } from '@/domains/profile';
import { useIsOnline } from '@/hooks/use-is-online';
import { t, type TranslationKey } from '@/i18n';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { colors, spacing } from '@/theme';
import { nameBeforePeriod } from '@/utils/text';

import { fanNameOf } from '../fan-name';

export interface FanModerationActionsProps {
  /** O id da rota, a chave do perfil em cache (`fanKeys.profile`). */
  fanId: string;
  profile: FanPublicProfile;
}

/**
 * O bloco "Segurança" do perfil público (seção 29, frente A): "Denunciar
 * perfil" e "Bloquear" (ou "Desbloquear", com o `blockedByMe`), dois botões
 * irmãos, um embaixo do outro, nunca dentro de outro pressável. Iguais nas
 * visões completa e fechada: o bloqueado não fica sabendo.
 *
 * Denunciar abre a sheet dos motivos. Bloquear pede confirmação pelo `Alert`
 * do sistema (que foca e anuncia), com "Bloquear e denunciar": o bloqueio não
 * chega à equipe, e a App Review pede que o bloqueio possa avisar (decisão
 * 13). Desbloquear sai direto: desfaz sem perda. O botão que bloqueia e o que
 * desbloqueia são o mesmo, para o foco do leitor de tela ficar nele quando o
 * rótulo troca. Os dois ficam desligados sem internet e enquanto um pedido
 * vai, com o "carregando" no tocado. O erro fica embaixo dos botões,
 * anunciado, com o toque de erro, na frase do `actionRefusal` (o teto, o
 * ritmo, o 404 ou a genérica). Bloquear e desbloquear são livres para o
 * suspenso.
 */
export function FanModerationActions({ fanId, profile }: FanModerationActionsProps) {
  const online = useIsOnline();
  const name = fanNameOf(profile);
  const blocked = profile.blockedByMe === true;
  const [failure, setFailure] = useState<TranslationKey | null>(null);
  // "Bloquear e denunciar": a sheet abre só depois de o bloqueio dar certo.
  const reportAfterBlock = useRef(false);

  const fail = (error: unknown, action: 'block' | 'unblock'): void => {
    const key = actionRefusal(error, action).key;
    setFailure(key);
    haptics.trigger('error');
    AccessibilityInfo.announceForAccessibility(t(key));
  };

  const block = useBlockFanMutation(fanId, {
    onDone: () => {
      haptics.trigger('success');
      AccessibilityInfo.announceForAccessibility(
        t('fanPage.blocked', { name: nameBeforePeriod(name) }),
      );
      if (!reportAfterBlock.current) return;
      reportAfterBlock.current = false;
      router.push({ pathname: '/denunciar-perfil/[fanId]', params: { fanId } });
    },
    onError: (error) => {
      reportAfterBlock.current = false;
      fail(error, 'block');
    },
  });
  const unblock = useUnblockFanMutation(fanId, {
    onDone: () => {
      haptics.trigger('success');
      AccessibilityInfo.announceForAccessibility(
        t('fanPage.unblocked', { name: nameBeforePeriod(name) }),
      );
    },
    onError: (error) => fail(error, 'unblock'),
  });
  const busy = block.isPending || unblock.isPending;
  const disabled = !online || busy;

  const startBlock = (thenReport: boolean): void => {
    reportAfterBlock.current = thenReport;
    block.block();
  };

  const confirmBlock = (): void => {
    setFailure(null);
    Alert.alert(t('fanPage.blockTitle', { name }), t('fanPage.blockMessage', { name }), [
      { text: t('fanPage.cancel'), style: 'cancel' },
      { text: t('fanPage.blockConfirm'), style: 'destructive', onPress: () => startBlock(false) },
      { text: t('fanPage.blockAndReport'), onPress: () => startBlock(true) },
    ]);
  };

  return (
    <View testID="fan-moderation">
      <SectionLabel>{t('fanPage.security')}</SectionLabel>
      <View style={styles.actions}>
        <Button
          label={t('fanPage.report')}
          variant="secondary"
          icon={Flag}
          onPress={() => {
            setFailure(null);
            router.push({ pathname: '/denunciar-perfil/[fanId]', params: { fanId } });
          }}
          disabled={disabled}
          accessibilityHint={t('fanPage.reportHint')}
          testID="fan-report"
        />
        <Button
          label={t(blocked ? 'fanPage.unblock' : 'fanPage.block')}
          variant="ghost"
          icon={Ban}
          onPress={() => {
            if (!blocked) {
              confirmBlock();
              return;
            }
            setFailure(null);
            unblock.unblock();
          }}
          loading={blocked ? unblock.isPending : block.isPending}
          disabled={disabled}
          haptic={blocked ? 'confirm' : 'tap'}
          accessibilityLabel={t(blocked ? 'fanPage.unblockLabel' : 'fanPage.blockLabel', { name })}
          accessibilityHint={blocked ? undefined : t('fanPage.blockHint')}
          testID="fan-block"
        />
        {failure ? (
          <Text variant="caption" color={colors.danger} style={styles.error}>
            {t(failure)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.listGap,
  },
  error: {
    textAlign: 'center',
  },
});
