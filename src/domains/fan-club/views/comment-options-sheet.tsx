import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Alert, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ChipGroup, type ChipItem } from '@/components/chip';
import { BackButton } from '@/components/header';
import { SheetGrabber } from '@/components/sheet-grabber';
import { Text } from '@/components/text';
import { useBlockFanMutation } from '@/domains/posts';
import { SuspensionContact } from '@/domains/profile';
import { useIsOnline } from '@/hooks/use-is-online';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t, type TranslationKey } from '@/i18n';
import { actionRefusal, type RefusalAction } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { colors, spacing } from '@/theme';
import { nameBeforePeriod } from '@/utils/text';

import { personName } from '../format';
import {
  useCachedFanClubComment,
  useCachedFanClubFollowing,
  useCachedFanClubPostOwner,
  useReportFanClubCommentMutation,
} from '../queries';
import type { FanClubComment, FanClubCommentReportReason } from '../types';

/** Aberta a frio (link), sem tela embaixo, a sheet volta para o início. */
function closeSheet(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

type ReasonChoice = FanClubCommentReportReason | 'none';

// Os motivos do Mural, sem o de imagem ("Sem motivo" manda null).
const REASONS: readonly ReasonChoice[] = ['none', 'spam', 'offensive', 'harassment', 'other'];

const REASON_ITEMS: readonly ChipItem<ReasonChoice>[] = REASONS.map((value) => ({
  value,
  label: t(`post.moderation.reasons.${value}`),
}));

/** O pedido que falhou por último, com o link "Escrever para a equipe" na conta suspensa. */
type Failure = { key: TranslationKey; contact: boolean } | null;

/** O nome do autor no título e nas frases: o nome, o @ ou "Fã". */
function authorName(comment: FanClubComment): string {
  return comment.author.name ?? personName(comment.author);
}

/**
 * Sheet "Opções do comentário" do fã-clube (`/comentario-fa-clube/[comentarioId]`,
 * seção 37, 37.9, item 10), aberta pelo botão de três pontos na linha do
 * comentário de outro fã, no molde da `comentario/[comentarioId]` do Mural:
 * Denunciar, com os motivos do Mural numa fileira de escolha única ("Sem
 * motivo" manda null), e Bloquear. O comentário vem do cache das listas da
 * tela da publicação, lido na abertura; aberta a frio, sem ele, a sheet fecha.
 *
 * Bloquear o autor de um comentário qualquer: os comentários dele somem para
 * o fã, e a sheet fecha e anuncia, porque o servidor recusa a denúncia do
 * comentário de quem o fã bloqueou (37.3). Só o gestor, no próprio fã-clube,
 * continua vendo os comentários de quem bloqueou, para poder ocultar (37.8):
 * para ele, o texto diz isso, e o botão dá lugar à frase do Mural, de que a
 * equipe só fica sabendo pela denúncia, com o "Denunciar comentário" ainda à
 * mão, que o servidor aceita dele. No comentário do gestor (o `isManager`),
 * o Bloquear vira o "Bloquear e denunciar" da página
 * (decisão 19 de 34.1), com os mesmos textos e o mesmo fluxo: o `Alert` do
 * sistema confirma (quem segue deixa de seguir e para de ver o fã-clube,
 * decisões 19 e 32), e o bloqueio que dá certo troca esta sheet pela
 * "Denunciar perfil" com o gestor; de volta, a tela da publicação mostra o 404
 * dela, porque o fã-clube some para quem bloqueou o gestor.
 *
 * Não é otimista: o botão tocado fica "carregando" até o servidor responder,
 * os dois ficam desligados sem internet e enquanto um pedido vai, e o voltar
 * fica preso. A denúncia que dá certo fecha e anuncia, com o toque de
 * sucesso. Erro: fica, com o aviso acima dos botões, anunciado, e o toque de
 * erro (o teto do dia, o ritmo, o comentário que saiu da vista, a conta
 * suspensa com o link "Escrever para a equipe", ou a genérica).
 */
export function FanClubCommentOptionsSheetScreen() {
  const params = useLocalSearchParams<{ comentarioId: string; publicacao: string }>();
  const commentId = typeof params.comentarioId === 'string' ? params.comentarioId : '';
  const postId = typeof params.publicacao === 'string' ? params.publicacao : '';
  const comment = useCachedFanClubComment(postId, commentId);
  // Aberta a frio (sem a lista da publicação no cache): não há o que mostrar.
  useEffect(() => {
    if (!comment) closeSheet();
  }, [comment]);
  if (!comment) return null;
  return <SheetContent comment={comment} postId={postId} />;
}

function SheetContent({ comment, postId }: { comment: FanClubComment; postId: string }) {
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const following = useCachedFanClubFollowing(postId, comment.clubId);
  // O gestor no próprio fã-clube vê todos os comentários, também os de quem bloqueou (37.8).
  const viewerIsOwner = useCachedFanClubPostOwner(postId);
  const [standalone] = useState(() => !router.canGoBack());
  const [reason, setReason] = useState<ReasonChoice>('none');
  const [failure, setFailure] = useState<Failure>(null);
  const [blocked, setBlocked] = useState(false);
  const name = authorName(comment);
  const manager = comment.isManager;
  // O gestor nas frases da página: o @ dele (decisão 8 de 34.1).
  const owner = personName(comment.author);
  // "Você bloqueou Thalita S." sem dois pontos.
  const blockedInvite = t('post.moderation.blockedReportInvite', {
    name: nameBeforePeriod(name),
  });

  const fail = (error: unknown, action: RefusalAction): void => {
    const refusal = actionRefusal(error, action);
    setFailure({ key: refusal.key, contact: refusal.type === 'suspended' });
    haptics.trigger('error');
    AccessibilityInfo.announceForAccessibility(t(refusal.key));
  };

  const report = useReportFanClubCommentMutation(postId, comment.id, {
    onDone: () => {
      haptics.trigger('success');
      closeSheet();
      AccessibilityInfo.announceForAccessibility(t('post.moderation.reported'));
    },
    onError: (error) => fail(error, 'clubCommentReport'),
  });
  const block = useBlockFanMutation(comment.author.uid, {
    onDone: () => {
      haptics.trigger('success');
      if (manager) {
        AccessibilityInfo.announceForAccessibility(
          t(following ? 'fanClub.page.blocked' : 'fanClub.page.blockedNotFollowing', {
            name: owner,
          }),
        );
        // A denúncia do perfil no lugar desta sheet: fechada, volta à tela da publicação.
        router.replace({
          pathname: '/denunciar-perfil/[fanId]',
          params: { fanId: comment.author.uid, clube: comment.clubId },
        });
        return;
      }
      // Fora do próprio fã-clube, os comentários de quem foi bloqueado somem, e
      // o servidor recusa a denúncia deles (37.3): a sheet fecha.
      if (!viewerIsOwner) {
        closeSheet();
        AccessibilityInfo.announceForAccessibility(t('post.moderation.blockedShort'));
        return;
      }
      setBlocked(true);
      AccessibilityInfo.announceForAccessibility(blockedInvite);
    },
    onError: (error) => fail(error, 'block'),
  });
  const busy = report.isPending || block.isPending;
  useStayOnScreen(busy);

  const blockMessage = t(
    following ? 'fanClub.page.blockMessage' : 'fanClub.page.blockMessageNotFollowing',
    { name: owner },
  );

  const startBlock = (): void => {
    setFailure(null);
    if (!manager) {
      block.block();
      return;
    }
    // O "Bloquear e denunciar" da página: o `Alert` do sistema foca, anuncia e confirma.
    Alert.alert(t('fanClub.page.blockTitle', { name: owner }), blockMessage, [
      { text: t('fanClub.page.cancel'), style: 'cancel' },
      { text: t('fanClub.page.blockConfirm'), style: 'destructive', onPress: () => block.block() },
    ]);
  };

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
          testID="club-comment-report-reasons"
        />
        <Text variant="headingSection" accessibilityRole="header" style={styles.section}>
          {t(manager ? 'fanClub.page.blockConfirm' : 'post.moderation.blockSection')}
        </Text>
        <Text variant="body" color={colors.textSecondary} style={styles.text}>
          {manager
            ? blockMessage
            : t(viewerIsOwner ? 'fanClub.comments.blockBodyOwner' : 'post.moderation.blockBody', {
                name,
              })}
        </Text>
        <View style={styles.actions}>
          {failure ? (
            <View>
              <Text variant="caption" color={colors.danger} style={styles.center}>
                {t(failure.key)}
              </Text>
              {failure.contact ? <SuspensionContact align="center" /> : null}
            </View>
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
            testID="club-comment-report"
          />
          {blocked ? (
            <Text
              variant="body"
              color={colors.textSecondary}
              style={styles.center}
              testID="club-comment-blocked"
            >
              {blockedInvite}
            </Text>
          ) : (
            <Button
              label={
                manager ? t('fanClub.page.blockConfirm') : t('post.moderation.block', { name })
              }
              variant="secondary"
              onPress={startBlock}
              loading={block.isPending}
              disabled={!online || busy}
              haptic={manager ? 'tap' : 'confirm'}
              testID="club-comment-block"
            />
          )}
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
  center: {
    textAlign: 'center',
  },
});
