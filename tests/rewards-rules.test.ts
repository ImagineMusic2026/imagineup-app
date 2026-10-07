import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regras da loja do bloco 10 (docs/arquitetura-api.md, 25.10) contra o
 * emulador. Rode com `npm run test:rules`. O catálogo (rewards) e os pedidos
 * (redemptions) são só do servidor: o fã recebe a loja e os próprios pedidos
 * pela API, nem o pedido com o uid dele lê direto. A equipe com a seção
 * rewards lê os dois, os contadores do dia (statsDaily) e os shows (events),
 * para escolher o show da recompensa. Ninguém grava pelo cliente.
 */
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'imagine-up-app',
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});

const ALL_SECTIONS = [
  'overview',
  'growth',
  'ranking',
  'fans',
  'artists',
  'missions',
  'rewards',
  'moderation',
  'audit',
];

// auth_time do login que ligou a conta à equipe (authValidAfter).
const LINKED_AT = 1_800_000_000;

type Member = {
  role: 'admin' | 'editor' | 'viewer';
  status: 'pending' | 'active' | 'disabled';
  sections?: string[];
  authValidAfter?: number;
};

const MEMBERS: Record<string, Member> = {
  admin: { role: 'admin', status: 'active' },
  editora: { role: 'editor', status: 'active', sections: ['rewards'] },
  leitor: { role: 'viewer', status: 'active', sections: ['rewards'] },
  fas: { role: 'viewer', status: 'active', sections: ['fans'] },
  semSecao: { role: 'editor', status: 'active', sections: ['artists', 'audit'] },
  crescimento: { role: 'viewer', status: 'active', sections: ['growth'] },
  desativada: { role: 'editor', status: 'disabled', sections: ['rewards'] },
  pendente: { role: 'admin', status: 'pending' },
  ligada: {
    role: 'editor',
    status: 'active',
    sections: ['rewards'],
    authValidAfter: LINKED_AT,
  },
};

const REWARD = 'rewards/ingressos';
const DRAFT = 'rewards/recompensa-rascunho';
const REDEMPTION = 'redemptions/UP-4KD9TM';
const STATS_DAY = 'statsDaily/2026-10-05';
const STATS_SHARD = `${STATS_DAY}/statsShards/7`;
const EVENT = 'events/sao-joao-irara';

/** Equipe, o perfil da Camila e os documentos da loja, como o servidor grava. */
async function seed(): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [uid, member] of Object.entries(MEMBERS)) {
      await setDoc(doc(db, `staff/${uid}`), {
        uid,
        email: `${uid}@imagine.music`,
        displayName: uid,
        role: member.role,
        sections: member.role === 'admin' ? ALL_SECTIONS : (member.sections ?? []),
        status: member.status,
        accountCreatedByInvite: member.authValidAfter === undefined,
        inviteId: `convite-${uid}`,
        invitedBy: null,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        updatedBy: null,
        ...(member.authValidAfter === undefined ? {} : { authValidAfter: member.authValidAfter }),
      });
    }
    await setDoc(doc(db, 'users/uid-camila'), {
      displayName: 'Camila Ribeiro',
      username: 'camilarib',
      city: null,
      photoURL: null,
      createdAt: Timestamp.now(),
    });
    const at = Timestamp.now();
    await setDoc(doc(db, REWARD), {
      kind: 'ticket',
      title: 'Par de ingressos',
      cost: 6_000,
      stockTotal: null,
      redeemedCount: 1,
      status: 'published',
      order: 2,
      instructions: 'Retire na bilheteria.',
    });
    await setDoc(doc(db, DRAFT), { kind: 'merch', title: 'Camisa autografada', status: 'draft' });
    await setDoc(doc(db, REDEMPTION), {
      code: 'UP-4KD9TM',
      rewardId: 'ingressos',
      uid: 'uid-camila',
      fanName: 'Camila Ribeiro',
      fanUsername: 'camilarib',
      status: 'delivered',
      points: 6_000,
      requestedAt: at,
      statusAt: at,
    });
    await setDoc(doc(db, STATS_DAY), { day: '2026-10-05' });
    await setDoc(doc(db, STATS_SHARD), {
      day: '2026-10-05',
      totals: { redeemRequested: 1, spent: 6_000 },
      byReward: { ingressos: { requested: 1, spent: 6_000 } },
    });
    await setDoc(doc(db, EVENT), {
      title: 'São João de Irará',
      artistIds: ['nettobrito'],
      status: 'published',
      startsAt: at,
    });
  });
}

type Db = ReturnType<RulesTestContext['firestore']>;
type Outcome = 'succeeds' | 'fails';

const as = (uid: string, authTime?: number) =>
  env
    .authenticatedContext(uid, authTime === undefined ? undefined : { auth_time: authTime })
    .firestore();
const anonymous = () => env.unauthenticatedContext().firestore();

/** Lê (get e list) o catálogo e os pedidos, como o painel lê. */
async function readsShop(db: Db, outcome: Outcome): Promise<void> {
  const check = outcome === 'succeeds' ? assertSucceeds : assertFails;
  await check(getDoc(doc(db, REWARD)));
  await check(getDoc(doc(db, DRAFT)));
  await check(getDocs(collection(db, 'rewards')));
  await check(getDoc(doc(db, REDEMPTION)));
  await check(getDocs(collection(db, 'redemptions')));
  await check(getDocs(query(collection(db, 'redemptions'), where('rewardId', '==', 'ingressos'))));
}

async function readsStats(db: Db, outcome: Outcome): Promise<void> {
  const check = outcome === 'succeeds' ? assertSucceeds : assertFails;
  await check(getDoc(doc(db, STATS_DAY)));
  await check(getDocs(collection(db, 'statsDaily')));
  await check(getDoc(doc(db, STATS_SHARD)));
  await check(getDocs(collection(db, `${STATS_DAY}/statsShards`)));
}

async function readsEvents(db: Db, outcome: Outcome): Promise<void> {
  const check = outcome === 'succeeds' ? assertSucceeds : assertFails;
  await check(getDoc(doc(db, EVENT)));
  await check(getDocs(collection(db, 'events')));
}

/** Nada da loja se grava pelo cliente: só o servidor (callables, API e exclusão de conta). */
async function writesNothing(db: Db): Promise<void> {
  await assertFails(setDoc(doc(db, 'rewards/nova'), { title: 'Nova', status: 'draft' }));
  await assertFails(updateDoc(doc(db, REWARD), { redeemedCount: 0 }));
  await assertFails(updateDoc(doc(db, REWARD), { cost: 1 }));
  await assertFails(deleteDoc(doc(db, DRAFT)));
  await assertFails(setDoc(doc(db, 'redemptions/UP-BBBBBB'), { uid: 'uid-camila' }));
  await assertFails(updateDoc(doc(db, REDEMPTION), { status: 'refused' }));
  await assertFails(deleteDoc(doc(db, REDEMPTION)));
  await assertFails(setDoc(doc(db, STATS_SHARD), { byReward: {} }));
  await assertFails(updateDoc(doc(db, EVENT), { title: 'Outro' }));
}

describe('catálogo e pedidos (rewards, redemptions)', () => {
  it('o fã logado não lê nem o pedido com o uid dele (vem pela API), e não grava', async () => {
    const fan = as('uid-camila');
    await readsShop(fan, 'fails');
    await assertFails(
      getDocs(query(collection(fan, 'redemptions'), where('uid', '==', 'uid-camila'))),
    );
    await writesNothing(fan);
  });

  it('sem login não lê nada', async () => {
    await readsShop(anonymous(), 'fails');
  });

  it('a equipe com rewards (editora e leitor) e o admin leem', async () => {
    for (const uid of ['admin', 'editora', 'leitor']) await readsShop(as(uid), 'succeeds');
    await readsShop(as('ligada', LINKED_AT), 'succeeds');
  });

  it('sem a seção, desativada, pendente ou com sessão de antes do authValidAfter não lê', async () => {
    for (const uid of ['fas', 'semSecao', 'crescimento', 'desativada', 'pendente']) {
      await readsShop(as(uid), 'fails');
    }
    await readsShop(as('ligada', LINKED_AT - 1), 'fails');
  });

  it('ninguém grava, nem admin', async () => {
    for (const uid of ['admin', 'editora', 'leitor']) await writesNothing(as(uid));
  });
});

describe('contadores do dia (statsDaily) e shows (events) para a seção rewards', () => {
  it('quem vê rewards lê os contadores do dia; quem só vê fans continua sem ler', async () => {
    for (const uid of ['editora', 'leitor', 'admin']) await readsStats(as(uid), 'succeeds');
    await readsStats(as('ligada', LINKED_AT), 'succeeds');
    for (const uid of ['fas', 'semSecao', 'desativada', 'uid-camila']) {
      await readsStats(as(uid), 'fails');
    }
    await readsStats(as('ligada', LINKED_AT - 1), 'fails');
    // A Crescimento continua lendo, como antes.
    await readsStats(as('crescimento'), 'succeeds');
  });

  it('quem vê só rewards lê os shows (get e list); o fã continua sem ler direto, e ninguém grava', async () => {
    for (const uid of ['editora', 'leitor']) await readsEvents(as(uid), 'succeeds');
    await readsEvents(as('uid-camila'), 'fails');
    await readsEvents(anonymous(), 'fails');
    await readsEvents(as('crescimento'), 'fails');
    await assertFails(setDoc(doc(as('editora'), 'events/novo'), { title: 'Novo' }));
    await assertFails(deleteDoc(doc(as('admin'), EVENT)));
  });
});
