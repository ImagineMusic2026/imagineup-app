import { INVITE_PATH_MAX, SHARE_LINK_BASE } from './consts';
import type { InviteLinkTarget } from './types';

/**
 * O código de convite como o servidor procura: sem espaços nem hífens, em
 * maiúsculas, no formato `^[A-Z0-9_]{3,64}$`; fora disso, `null`. É o único
 * jeito de o app tratar um código: na captura do link, no campo do cadastro,
 * na comparação do `bindPendingInvite`, nos corpos do claim e da visita e nas
 * chaves. Cópia do `normalizeInviteCode` de `functions/src/invites/model.ts`,
 * com a mesma tabela de testes: mudou uma, mude a outra. Confere o ASCII antes
 * de passar para maiúsculas (o `ß` viraria `SS`).
 */
export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const compact = raw.replace(/[\s-]+/g, '');
  return /^[A-Za-z0-9_]{3,64}$/.test(compact) ? compact.toUpperCase() : null;
}

/**
 * Link de uma página do app com o código de convite do fã (`?ref=CODIGO`), para
 * quem abrir cair na página e o convite ser atribuído a ele. Sem código (ainda
 * não carregou), sai o link puro: compartilhar continua funcionando, só não
 * rende pontos. A base é a do servidor (`MyInvite.linkBase`) quando ela chegou,
 * para a troca de domínio não pedir build nova. Puro e sem Firebase, como o
 * resto do `index.ts` deste domínio.
 */
export function buildInviteUrl(
  code: string | null,
  path: string,
  base: string = SHARE_LINK_BASE,
): string {
  const page = path.startsWith('/') ? path : `/${path}`;
  const root = base.replace(/\/+$/, '');
  if (!code) return `${root}${page}`;
  const separator = page.includes('?') ? '&' : '?';
  return `${root}${page}${separator}ref=${encodeURIComponent(code)}`;
}

/**
 * O id do link compartilhado no servidor (`PUT /me/invite/links/:linkId`): um
 * por destino. `invite` é o atalho Convidar; o show do "Chamar amigos" leva à
 * agenda (`agenda`).
 */
export function inviteLinkId(target: InviteLinkTarget): string {
  switch (target.kind) {
    case 'post':
      return `post:${target.postId}`;
    case 'artist':
      return `artist:${target.artistId}`;
    default:
      return target.kind;
  }
}

/**
 * O caminho do link como vai ao servidor, que só o usa para saber o tipo do
 * link (post, central, agenda) e ignora a busca: sem a busca, e `/` quando
 * passa do tamanho ou tem `//` (o servidor recusaria, e o convite se perderia).
 */
export function invitePathForServer(path: string): string {
  const clean = path.split(/[?#]/, 1)[0] ?? '/';
  if (!clean.startsWith('/') || clean.includes('//') || clean.length > INVITE_PATH_MAX) return '/';
  return clean;
}
