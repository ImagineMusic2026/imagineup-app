/**
 * Convite com atribuição e origem do fã (bloco 5). Os corpos e resultados
 * espelham o `functions/src/api/contract.ts`: mudou um, mude o outro.
 */

/** Os `utm_*` que ficam: só estes três; os outros saem do link (`utm_content`, `utm_term`...). */
export interface InviteUtm {
  source?: string;
  medium?: string;
  campaign?: string;
}

/** De onde o link veio: a página que ele abria (sem a busca) e a campanha. */
export interface InviteOrigin {
  path: string;
  utm: InviteUtm;
}

/** O convite do link que abriu o app, guardado no aparelho até alguém se cadastrar. */
export interface PendingInvite {
  /** Já normalizado (`normalizeInviteCode`). */
  code: string;
  /** ISO, do relógio do aparelho. */
  receivedAt: string;
  origin: InviteOrigin;
}

/** `link`: o código do link guardado; `code`: digitado no cadastro. */
export type InviteVia = 'link' | 'code';

/**
 * O convite amarrado a uma conta no cadastro: só a sessão confirmada desse
 * uid manda, com a mesma chave de idempotência em toda tentativa.
 */
export interface BoundInvite {
  uid: string;
  code: string;
  via: InviteVia;
  /** null no código digitado. */
  origin: InviteOrigin | null;
  /** O do link (via `link`), ou o mesmo do `boundAt` (via `code`). */
  receivedAt: string;
  boundAt: string;
  /** `invite-<CODIGO>-<receivedAt>`. */
  idempotencyKey: string;
}

/** `POST /invites/claim`. */
export interface InviteClaimBody {
  code: string;
  via: InviteVia;
  link: { path: string } | null;
  utm?: InviteUtm;
  openedAt?: string | null;
}

export interface InviteClaimResult {
  status: 'claimed' | 'already_claimed';
}

/** `POST /invites/visit`. */
export interface InviteVisitBody {
  code: string;
  link: { path: string };
  utm?: InviteUtm;
  openedAt?: string | null;
}

/**
 * A resposta da visita, sempre a mesma: o servidor não diz se a pessoa contou,
 * para a resposta não servir de teste do e-mail de ninguém (o app não mostra nada).
 */
export interface InviteVisitResult {
  status: 'received';
}

/** `PUT /me/invite/links/:linkId`. */
export interface InviteLinkResult {
  linkId: string;
  created: boolean;
}

/** Para onde o link compartilhado leva: um link por destino no servidor. */
export type InviteLinkTarget =
  | { kind: 'invite' }
  | { kind: 'agenda' }
  | { kind: 'post'; postId: string }
  | { kind: 'artist'; artistId: string };
