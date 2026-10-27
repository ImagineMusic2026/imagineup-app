import { useState, type Ref } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { SuspensionContact } from '@/domains/profile';
import { useIsOnline } from '@/hooks/use-is-online';
import { t, type TranslationKey, type TranslationParams } from '@/i18n';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { borderWidths, colors, spacing } from '@/theme';

import { fanClubErrorText } from '../describe';
import type { useFollowFanClubMutation } from '../queries';
import type { FanClubPostDetails } from '../types';

function announce(message: string): void {
  AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
}

export interface FollowToCommentProps {
  post: FanClubPostDetails;
  /** O teclado cobre o pé da tela (`useKeyboardVisible`). */
  keyboardVisible: boolean;
  /**
   * O seguir da tela (`useFollowFanClubMutation`): mora nela, porque este pé
   * sai no próprio sucesso, e o "+N" da entrada na central sobe da tela.
   */
  follow: ReturnType<typeof useFollowFanClubMutation>;
  /** O botão "Seguir o fã-clube", para o botão dos comentários do cabeçalho levar o foco até ele. */
  buttonRef?: Ref<View>;
  /** O seguir deu certo: a tela leva o foco ao campo, que aparece no lugar. */
  onFollowed?: () => void;
}

/**
 * O "Seguir para comentar" (seção 37, 37.9, item 5): no pé da tela da
 * publicação, no lugar do campo, para quem não segue e não é o gestor
 * (decisão 10 de 36.1): "Siga o fã-clube para comentar e reagir." e o
 * "Seguir o fã-clube", com a linha "Você também entra na central" para quem
 * não é membro e o aviso de que o gestor vê que você é membro (decisão 5 de
 * 36.1; seção 37, "Estado"), os dois também no rótulo do botão. O seguir é o
 * da página (`useFollowFanClubMutation`, que a tela passa): no sucesso, a
 * publicação passa a "seguindo" no cache, e o campo aparece no lugar; o "+N"
 * do seguir que fez a entrada sobe da tela, que continua montada. A recusa
 * fica embaixo, anunciada, com o link da equipe para a conta suspensa.
 */
export function FollowToComment({
  post,
  keyboardVisible,
  follow,
  buttonRef,
  onFollowed,
}: FollowToCommentProps) {
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const [failure, setFailure] = useState<{
    key: TranslationKey;
    params?: TranslationParams;
    suspended: boolean;
  } | null>(null);
  const joinLine = !post.isMember;
  const paddingBottom = keyboardVisible ? spacing.md : Math.max(insets.bottom, spacing.md);

  const run = (): void => {
    setFailure(null);
    follow.mutate(
      { id: post.clubId, artistId: post.artistId },
      {
        onSuccess: (result) => {
          haptics.trigger('success');
          announce(t('fanClub.page.followed', { name: post.clubName }));
          if (result.joined) announce(t('artist.join.joined', { name: post.artistName }));
          onFollowed?.();
        },
        onError: (error) => {
          const text = fanClubErrorText(error);
          const refusal = actionRefusal(error, 'clubFollow');
          const key = text?.key ?? refusal.key;
          setFailure({ key, params: text?.params, suspended: refusal.type === 'suspended' });
          haptics.trigger('error');
          AccessibilityInfo.announceForAccessibility(t(key, text?.params));
        },
      },
    );
  };

  return (
    <View style={[styles.container, { paddingBottom }]} testID="fan-club-follow-to-comment">
      <Text variant="bodySmall" color={colors.textSecondary} style={styles.center}>
        {t('fanClub.postScreen.followToComment')}
      </Text>
      <Button
        ref={buttonRef}
        label={t('fanClub.page.follow')}
        variant="primary"
        size="md"
        loading={follow.isPending}
        disabled={!online}
        haptic="confirm"
        onPress={run}
        accessibilityLabel={t(
          joinLine ? 'fanClub.page.followJoinLabel' : 'fanClub.page.followLabel',
          { name: post.clubName, artist: post.artistName },
        )}
        testID="fan-club-post-follow"
      />
      {joinLine ? (
        // No rótulo do botão; aqui, só para quem vê.
        <Text
          variant="caption"
          color={colors.textSecondary}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.center}
        >
          {t('fanClub.page.followJoinLine', { artist: post.artistName })}
        </Text>
      ) : null}
      <Text
        variant="caption"
        color={colors.textSecondary}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.center}
        testID="fan-club-post-member-notice"
      >
        {t('fanClub.page.memberNotice')}
      </Text>
      {failure ? (
        <View style={styles.failure}>
          <Text variant="caption" color={colors.danger} style={styles.center}>
            {t(failure.key, failure.params)}
          </Text>
          {failure.suspended ? <SuspensionContact align="center" /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: borderWidths.default,
    borderTopColor: colors.divider,
  },
  center: {
    textAlign: 'center',
  },
  failure: {
    gap: spacing.xs,
  },
});
