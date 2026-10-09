// O ranking pelo arquivo, nunca pelo index: o ranking importa o perfil (o
// `useFanIdentity`), e o index fecharia um ciclo. O ranking/fixtures.ts não
// importa nada do perfil.
import { RANKING_SEED } from '@/domains/ranking/fixtures';
import { ApiError } from '@/services/api/errors';
import { fixtureDelay } from '@/services/fixtures';

import { SOCIAL_NETWORKS } from './details';
import type { FanPublicProfile, FanSocials, Gender } from './types';

/**
 * O perfil público de outro fã nas builds sem API (seção 28, 28.10): o mesmo
 * que o seed dos emuladores grava, para a regra de coerência. A Thalita
 * (completa, com o gênero para provar que ele não sai), a Aline (conta privada,
 * com a bio e as redes preenchidas para provar que não saem) e a Renata
 * (suspensa) vêm da tabela de 28.10; os outros do ranking têm só a foto, o nome
 * e o @. Os autores dos comentários de exemplo (`posts/fixtures.ts`) usam
 * outros ids: os que são gente do ranking abrem o perfil dela, e os sem par
 * ganham um perfil sem bio nem redes.
 *
 * O nome do comentário de exemplo continua o do protótipo ("Thalita S."), e o
 * perfil mostra o do ranking ("Thalita Santos"): diferença aceita só aqui (no
 * servidor, a fila de 24.7 acerta a cópia do comentário). As fixtures não
 * modelam "o outro me bloqueou" (o `moderationFixture` só sabe quem o fã
 * bloqueou). `__tests__/fan-fixtures.test.ts` trava a coerência; mudou a
 * tabela do seed (`functions/src/fan-profile/seed.ts`), mude aqui.
 */

/** O corte do @ que o gerador do servidor dá (`BASE_MAX` de `functions/src/profile.ts`). */
const USERNAME_BASE_MAX = 15;

/**
 * O @ que o cadastro dá ao nome (a regra do `usernameBase` do servidor): o
 * primeiro nome mais as 3 primeiras letras do último, sem acento, em
 * minúsculas, até 15 ("Thalita Santos" vira "thalitasan"). O teste das funções
 * prova que os nomes do seed não colidem, então o @ do emulador é este.
 */
export function fixtureUsername(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const [first = '', ...rest] = words;
  const last = rest.at(-1);
  return (first + (last ? last.slice(0, 3) : '')).slice(0, USERNAME_BASE_MAX);
}

/** Uma linha da tabela de 28.10, como o seed grava (só as redes preenchidas). */
export interface FanFixtureDetails {
  bio: string | null;
  /** Só a equipe vê: guardado para provar que a resposta não leva. */
  gender: Gender | null;
  privateAccount: boolean;
  /** A conta suspensa do seed (`SEED_SUSPENDED_EMAIL`). */
  suspended: boolean;
  socials: Partial<FanSocials>;
}

/** As linhas da Thalita, da Aline e da Renata, copiadas da tabela de 28.10. */
export const FAN_FIXTURE_DETAILS: Readonly<Record<string, FanFixtureDetails>> = {
  'fa-rank-01': {
    bio: 'Do arrocha ao piseiro, sigo o Netto em todo São João.\nIrará na veia.',
    gender: 'woman',
    privateAccount: false,
    suspended: false,
    socials: {
      instagram: 'thalita.teste.up',
      tiktok: 'thalita.teste.up',
      linkedin: 'thalita-teste-imagineup',
      x: 'thalitatesteup',
    },
  },
  'fa-rank-05': {
    bio: 'Conta de teste privada. Esta bio não aparece para os outros fãs.',
    gender: 'undisclosed',
    privateAccount: true,
    suspended: false,
    socials: { instagram: 'aline.teste.up', x: 'alinetesteup' },
  },
  'fa-rank-48': {
    bio: null,
    gender: null,
    privateAccount: false,
    suspended: true,
    socials: {},
  },
};

/** Os autores dos comentários de exemplo que são gente do ranking: o id do comentário e o do ranking. */
export const COMMENT_AUTHOR_ALIASES: Readonly<Record<string, string>> = {
  'fa-thalita': 'fa-rank-01',
  'fa-davi': 'fa-rank-02',
  'fa-jean': 'fa-rank-03',
  'fa-maria-clara': 'fa-rank-04',
  'fa-bruna': 'fa-rank-06',
  'fa-igor': 'fa-rank-07',
  'fa-leila': 'fa-rank-08',
  'fa-rafael': 'fa-rank-09',
  'fa-julia': 'fa-rank-10',
  'fa-pedro': 'fa-rank-11',
};

/**
 * Os autores dos comentários de exemplo sem par no ranking, com o nome do
 * perfil (o Alan é o mesmo do seed; a Duda fica com o nome do comentário).
 * Sem bio nem redes.
 */
export const COMMENT_ONLY_AUTHORS: Readonly<Record<string, string>> = {
  'fa-alan': 'Alan Ferreira',
  'fa-carla': 'Carla M.',
  'fa-diego': 'Diego S.',
  'fa-eduarda': 'Duda Rocha',
};

const has = (record: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

/** O nome do perfil por trás de um id, ou `null` quando ninguém tem esse id. */
function displayNameOf(fanId: string): string | null {
  const rankId = has(COMMENT_AUTHOR_ALIASES, fanId) ? COMMENT_AUTHOR_ALIASES[fanId]! : fanId;
  const person = RANKING_SEED.find((seed) => seed.userId === rankId);
  if (person) return person.displayName;
  return has(COMMENT_ONLY_AUTHORS, fanId) ? COMMENT_ONLY_AUTHORS[fanId]! : null;
}

/** As quatro redes, `null` na vazia; sem nenhuma, `null` (como o servidor). */
function socialsOf(socials: Partial<FanSocials>): FanSocials | null {
  const full = Object.fromEntries(
    SOCIAL_NETWORKS.map((network) => [network, socials[network] ?? null]),
  ) as FanSocials;
  return SOCIAL_NETWORKS.some((network) => full[network] !== null) ? full : null;
}

/**
 * O perfil público como o `GET /fans/:fanId` responde, montado campo a campo
 * (nunca o gênero nem a conta privada). Fechado na privada e na suspensa, com
 * o mesmo corpo. Id que ninguém tem, o do próprio fã (`me`, a linha dele no
 * ranking de exemplo) e o de uma central (o comentário do artista): 404
 * `fan_not_found`, como a API.
 */
export function buildFanProfileFixture(fanId: string): FanPublicProfile {
  const displayName = displayNameOf(fanId);
  if (displayName === null) {
    throw new ApiError('notFound', `Fã ${fanId} não existe nas fixtures.`, 404, 'fan_not_found');
  }
  const rankId = has(COMMENT_AUTHOR_ALIASES, fanId) ? COMMENT_AUTHOR_ALIASES[fanId]! : fanId;
  const details = has(FAN_FIXTURE_DETAILS, rankId) ? FAN_FIXTURE_DETAILS[rankId] : undefined;
  const base = {
    uid: fanId,
    displayName,
    username: fixtureUsername(displayName),
    photoURL: null,
  };
  if (details && (details.privateAccount || details.suspended)) {
    return { ...base, restricted: true, bio: null, socials: null };
  }
  return {
    ...base,
    restricted: false,
    bio: details?.bio ?? null,
    socials: details ? socialsOf(details.socials) : null,
  };
}

/** O `GET /fans/:fanId` das fixtures, com a espera de exemplo. */
export async function fanProfileFixture(fanId: string): Promise<FanPublicProfile> {
  await fixtureDelay();
  return buildFanProfileFixture(fanId);
}
