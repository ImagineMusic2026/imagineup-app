import type { TranslationKey } from '@/i18n';

import { FAN_CLUB_PENDING_MAX } from './consts';
import { UNAVAILABLE_TEXTS } from './describe';
import type { FanClubPostStatus, MyFanClubClub, OwnFanClubPost } from './types';

// O modo gestor do "Meu fã-clube" (34.24): as abas, os filtros de Publicações
// e o que o "+" faz, sem React. Puro, para o teste em tabela.

/** As abas, com o nome que vai no endereço (`/meu-fa-clube?aba=publicacoes`). */
export const MANAGER_TABS = ['painel', 'publicacoes', 'premios', 'conta'] as const;

export type ManagerTab = (typeof MANAGER_TABS)[number];

/** A aba do endereço; fora da lista (ou sem ela), o Painel. */
export function managerTabOf(value: unknown): ManagerTab {
  return (MANAGER_TABS as readonly unknown[]).includes(value) ? (value as ManagerTab) : 'painel';
}

/**
 * Os filtros de Publicações (`?filtro=`) e os status de cada um
 * (`FanClubPostStatus`). "Outras" junta o que saiu sem a recusa da revisão:
 * a retirada e a tirada do ar pelo gestor e a oculta pela equipe, que antes
 * apareciam em "Minhas publicações" e continuam a um toque.
 */
export const POST_FILTERS = {
  'no-ar': ['published'],
  'em-analise': ['pending'],
  recusadas: ['rejected'],
  outras: ['withdrawn', 'hidden', 'removed'],
} as const satisfies Record<string, readonly FanClubPostStatus[]>;

export type PostFilter = keyof typeof POST_FILTERS;

export const POST_FILTER_KEYS = Object.keys(POST_FILTERS) as PostFilter[];

/** O filtro do endereço; fora da lista (ou sem ele), "No ar". */
export function postFilterOf(value: unknown): PostFilter {
  return (POST_FILTER_KEYS as readonly unknown[]).includes(value) ? (value as PostFilter) : 'no-ar';
}

/** As publicações de um filtro, na ordem em que vieram (da mais nova). */
export function postsIn(posts: readonly OwnFanClubPost[], filter: PostFilter): OwnFanClubPost[] {
  const statuses: readonly FanClubPostStatus[] = POST_FILTERS[filter];
  return posts.filter((post) => statuses.includes(post.status));
}

/**
 * Por que o "+" não abre a nova publicação, na ordem do servidor: o fã-clube
 * fora do ar (com o motivo), o regulamento velho e as 3 em análise. Null: pode
 * publicar.
 */
export type PostBlock =
  { kind: 'unavailable'; key: TranslationKey } | { kind: 'rules' } | { kind: 'full' } | null;

export function postBlockOf(club: MyFanClubClub): PostBlock {
  if (!club.available) {
    return {
      kind: 'unavailable',
      key: club.unavailableReason
        ? UNAVAILABLE_TEXTS[club.unavailableReason]
        : 'fanClub.newPost.unavailable',
    };
  }
  if (club.rulesOutdated) return { kind: 'rules' };
  if (club.pendingPosts >= FAN_CLUB_PENDING_MAX) return { kind: 'full' };
  return null;
}
