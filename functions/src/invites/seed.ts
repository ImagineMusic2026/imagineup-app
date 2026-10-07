import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { createConfigSource, DEFAULT_POINTS_CONFIG } from '../points/config';
import { SEED_ACTOR } from '../points/seed';
import {
  classifyInvitePath,
  NO_UTM,
  parseLinkId,
  personKey,
  type ClaimInput,
  type VisitInput,
} from './model';
import {
  fanInviteRef,
  inviteCodeRef,
  runClaim,
  runInviteLinks,
  runVisit,
  type ClaimOutcome,
  type InviteCaller,
  type VisitOutcome,
} from './service';

// Convite da Camila no seed dos emuladores (scripts/seed-emulators.mjs, que
// carrega este build): o código do protótipo, os links que ela compartilhou e
// três convidados de teste, pelo mesmo núcleo das rotas. Nunca roda em
// produção: o script fixa o emulador. docs/arquitetura-api.md, 20.12.

/**
 * O código da Camila: o mesmo da fixture (`buildMyInviteFixture` do app), para
 * a sheet "Gerar meu link" mostrar o mesmo código nos dois modos. Tem vogais e
 * não sai do sorteio (INVITE_CODE_ALPHABET), então não colide.
 */
export const CAMILA_INVITE_CODE = 'CAMILA12';

/**
 * Segredo do HMAC no emulador. O scripts/functions-emulator-env.mjs grava o
 * mesmo valor em functions/.secret.local (INVITE_KEY_SECRET): a `api` do
 * emulador, o seed e os testes calculam a mesma chave da pessoa, sem um ramo
 * pelo FUNCTIONS_EMULATOR no código da chave. Mudou um, mude o outro.
 */
export const EMULATOR_INVITE_KEY = 'segredo-do-convite-no-emulador';

/** Os links que a Camila compartilhou: o atalho Convidar, o clipe, a central do Netto e a agenda. */
export const CAMILA_INVITE_LINKS = ['invite', 'post:p-clipe', 'artist:nettobrito', 'agenda'];

/** Como cada convidado de teste chegou (as contas ficam no scripts/seed-emulators.mjs). */
export type SeedInviteOrigin =
  | {
      via: 'link';
      path: string;
      utm?: { source?: string; medium?: string; campaign?: string };
    }
  | { via: 'code' };

/** Bia pelo link do clipe com campanha, Duda pelo link da central, Enzo pelo código digitado. */
export const SEED_INVITEES: readonly { email: string; origin: SeedInviteOrigin }[] = [
  {
    email: 'bia@teste.imagineup',
    origin: {
      via: 'link',
      path: '/post/p-clipe',
      utm: { source: 'instagram', medium: 'story', campaign: 'sao-joao' },
    },
  },
  { email: 'duda@teste.imagineup', origin: { via: 'link', path: '/artista/nettobrito' } },
  { email: 'enzo@teste.imagineup', origin: { via: 'code' } },
];

/** Quanto antes do claim o link abriu o app (informativo, como o relógio do aparelho). */
const OPENED_BEFORE_MS = 5 * 60 * 1000;

/** O corpo do claim de um convidado de teste, como o app mandaria (já normalizado). */
export function seedClaimInput(origin: SeedInviteOrigin, now: number): ClaimInput {
  if (origin.via === 'code') {
    return {
      code: CAMILA_INVITE_CODE,
      via: 'code',
      link: null,
      utm: { ...NO_UTM },
      openedAt: null,
    };
  }
  return {
    code: CAMILA_INVITE_CODE,
    via: 'link',
    link: classifyInvitePath(origin.path),
    utm: {
      source: origin.utm?.source ?? null,
      medium: origin.utm?.medium ?? null,
      campaign: origin.utm?.campaign ?? null,
    },
    openedAt: now - OPENED_BEFORE_MS,
  };
}

/**
 * Valores do convite em 0: os lançamentos saem `zero` e a carteira da Camila
 * fica a do protótipo (seção 14). Pontos de verdade só pelo app (20.12).
 */
const SEED_INVITE_CONFIG = {
  ...DEFAULT_POINTS_CONFIG,
  values: { ...DEFAULT_POINTS_CONFIG.values, invite_visit: 0, invite_signup: 0 },
};

/**
 * O código CAMILA12 (com o `ownerKey` do e-mail dela) e fanInvites/{uid}, se
 * ainda não existem, e os 4 links pelo mesmo núcleo do `PUT`, sem marcar
 * atividade. Rodar de novo não muda nada. Devolve quantos links criou.
 */
export async function seedCamilaInvite(
  db: Firestore,
  camila: InviteCaller,
  now: number = Date.now(),
): Promise<number> {
  const at = Timestamp.fromMillis(now);
  await db.runTransaction(async (tx) => {
    const [code, invite] = await tx.getAll(
      inviteCodeRef(db, CAMILA_INVITE_CODE),
      fanInviteRef(db, camila.uid),
    );
    if (!code!.exists) {
      tx.create(code!.ref, {
        code: CAMILA_INVITE_CODE,
        kind: 'fan',
        uid: camila.uid,
        ownerKey: personKey(camila.email, camila.uid, EMULATOR_INVITE_KEY),
        createdAt: at,
        schemaVersion: 1,
      });
    }
    if (!invite!.exists) {
      tx.create(invite!.ref, {
        uid: camila.uid,
        code: CAMILA_INVITE_CODE,
        createdAt: at,
        schemaVersion: 1,
      });
    }
  });
  const links = CAMILA_INVITE_LINKS.map((id) => parseLinkId(id)!);
  return runInviteLinks(db, camila.uid, links, {
    now,
    config: SEED_INVITE_CONFIG,
    actor: SEED_ACTOR,
  });
}

/**
 * Os convidados de teste da Camila, cada um pelo mesmo claimInvite da rota
 * (runClaim), com o e-mail da conta, os valores do convite em 0 e o jogo da
 * configuração lida agora (bloco 7: o claim anda as missões de link e de
 * convite da Camila e dá o "Boca a boca"; a ordem do seed decide o que já
 * existe, 22.13). O claim cria o marcador de visita e soma o cadastro
 * convidado e a visita nos agregados do dia. Rodar de novo responde
 * `already_claimed`.
 */
export async function seedInviteClaims(
  db: Firestore,
  invitees: readonly (InviteCaller & { origin: SeedInviteOrigin })[],
  now: number = Date.now(),
): Promise<ClaimOutcome[]> {
  const { game } = await createConfigSource(db, { ttlMs: 0 }).get();
  const outcomes: ClaimOutcome[] = [];
  for (const invitee of invitees) {
    outcomes.push(
      await runClaim(
        db,
        { uid: invitee.uid, email: invitee.email },
        seedClaimInput(invitee.origin, now),
        {
          now,
          config: SEED_INVITE_CONFIG,
          actor: SEED_ACTOR,
          inviteKey: EMULATOR_INVITE_KEY,
          game,
        },
      ),
    );
  }
  return outcomes;
}

/** O link que o Alan e a Gabi abrem no seed: o do clipe, com o código da Camila. */
export const SEED_VISIT_PATH = '/post/p-clipe';

/** Quem visita o link do clipe no seed (só visita, sem cadastro pelo convite). */
export const SEED_VISITORS: readonly string[] = ['alan@teste.imagineup', 'gabi@teste.imagineup'];

/** O corpo da visita de teste, como o app mandaria (já normalizado). */
export function seedVisitInput(now: number): VisitInput {
  return {
    code: CAMILA_INVITE_CODE,
    link: classifyInvitePath(SEED_VISIT_PATH),
    utm: { ...NO_UTM },
    openedAt: now - OPENED_BEFORE_MS,
  };
}

/**
 * As visitas de teste ao link do clipe (bloco 7, 22.13), pelo mesmo
 * recordInviteVisit da rota (runVisit), com ator de sistema, o convite em 0 e
 * o jogo lido agora: cada uma cria o marcador e anda o "Leve 5 pessoas" da
 * Camila. Rodar de novo não conta: o marcador já existe.
 */
export async function seedInviteVisits(
  db: Firestore,
  visitors: readonly InviteCaller[],
  now: number = Date.now(),
): Promise<VisitOutcome[]> {
  const { game } = await createConfigSource(db, { ttlMs: 0 }).get();
  const outcomes: VisitOutcome[] = [];
  for (const visitor of visitors) {
    outcomes.push(
      await runVisit(db, visitor, seedVisitInput(now), {
        now,
        config: SEED_INVITE_CONFIG,
        actor: SEED_ACTOR,
        inviteKey: EMULATOR_INVITE_KEY,
        game,
      }),
    );
  }
  return outcomes;
}
