import { buildInviteUrl, inviteLinkId } from '@/domains/invites';
import { postPath } from '@/domains/posts';
import { t } from '@/i18n';

/**
 * Para onde o link do convite leva: o post da missão (1b, 1g), a agenda com
 * o show do "Chamar amigos" (1m) ou o app, pelo atalho Convidar do "+".
 * O nome do artista e o do show chegam depois (ou nunca, num link a frio), e
 * o texto tem a versão sem eles.
 */
export type InviteTarget =
  | { kind: 'post'; postId: string; artistName: string | null }
  | { kind: 'event'; showTitle: string | null }
  | { kind: 'artist'; artistId: string; artistName: string | null }
  | { kind: 'app' };

/** A agenda não tem página de um show só: o link do show leva para ela. */
const AGENDA_PATH = '/agenda';

/** A central no app, o mesmo caminho do compartilhar da 1d (`artistPath`). */
const centralPath = (artistId: string) => `/artista/${encodeURIComponent(artistId)}`;

/** O link compartilhado no servidor ("links criados"): o post, a agenda ou o atalho Convidar. */
export function inviteTargetLinkId(target: InviteTarget): string {
  switch (target.kind) {
    case 'post':
      return inviteLinkId({ kind: 'post', postId: target.postId });
    case 'event':
      return inviteLinkId({ kind: 'agenda' });
    case 'artist':
      return inviteLinkId({ kind: 'artist', artistId: target.artistId });
    default:
      return inviteLinkId({ kind: 'invite' });
  }
}

/** Caminho no app que o link abre (o `+native-intent` lê o `?ref=` dele). */
export function inviteTargetPath(target: InviteTarget): string {
  switch (target.kind) {
    case 'post':
      return postPath(target.postId);
    case 'event':
      return AGENDA_PATH;
    case 'artist':
      return centralPath(target.artistId);
    default:
      return '/';
  }
}

/** "Leva para o post de Netto Brito.", embaixo do link. */
export function inviteTargetText(target: InviteTarget): string {
  switch (target.kind) {
    case 'post':
      return target.artistName
        ? t('invite.target.post', { artist: target.artistName })
        : t('invite.target.postPlain');
    case 'event':
      return target.showTitle
        ? t('invite.target.event', { show: target.showTitle })
        : t('invite.target.eventPlain');
    case 'artist':
      return target.artistName
        ? t('invite.target.artist', { artist: target.artistName })
        : t('invite.target.artistPlain');
    default:
      return t('invite.target.app');
  }
}

/** O texto que vai junto com o link na folha de compartilhar. */
export function inviteMessage(target: InviteTarget): string {
  if (target.kind === 'post' && target.artistName) {
    return t('post.shareMessage', { artist: target.artistName });
  }
  if (target.kind === 'event' && target.showTitle) {
    return t('invite.message.event', { show: target.showTitle });
  }
  if (target.kind === 'artist' && target.artistName) {
    return t('artist.shareMessage', { name: target.artistName });
  }
  return t('invite.message.app');
}

export interface InviteLinkDisplay {
  /** O link inteiro, que vai para a folha de compartilhar. */
  url: string;
  /** O link na tela, sem o `https://`. */
  display: string;
  /** Para onde ele leva. */
  targetText: string;
  /** O link para o leitor de tela: o código e o destino, sem soletrar o endereço. */
  accessibilityLabel: string;
}

/**
 * O link do fã para o destino, com o código de convite (`?ref=`). Sem código
 * (não carregou), sai o link puro: compartilhar continua funcionando, só não
 * rende pontos, e a tela avisa. A base é a do servidor (`MyInvite.linkBase`)
 * quando ela chegou.
 */
export function describeInviteLink(
  target: InviteTarget,
  code: string | null,
  base?: string,
): InviteLinkDisplay {
  const url = buildInviteUrl(code, inviteTargetPath(target), base);
  const targetText = inviteTargetText(target);
  return {
    url,
    display: url.replace(/^https?:\/\//, ''),
    targetText,
    accessibilityLabel: code
      ? t('invite.linkA11y', { code, target: targetText })
      : t('invite.linkA11yNoCode', { target: targetText }),
  };
}
