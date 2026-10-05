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
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regras das coleções do núcleo de pontos (docs/arquitetura-api.md, seção 11)
 * contra o emulador. Rode com `npm run test:rules`. Tudo é gravado pelo
 * servidor (Admin SDK): o fã lê os pontos pela API, nunca direto, nem os
 * próprios; a equipe lê pelas seções do painel (fans, overview, growth).
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
  editora: { role: 'editor', status: 'active', sections: ['fans'] },
  leitor: { role: 'viewer', status: 'active', sections: ['fans'] },
  visaoGeral: { role: 'viewer', status: 'active', sections: ['overview'] },
  crescimento: { role: 'editor', status: 'active', sections: ['growth'] },
  semSecao: { role: 'viewer', status: 'active', sections: ['artists', 'audit'] },
  desativada: { role: 'editor', status: 'disabled', sections: ['fans', 'overview', 'growth'] },
  pendente: { role: 'admin', status: 'pending' },
  ligada: {
    role: 'editor',
    status: 'active',
    sections: ['fans', 'overview'],
    authValidAfter: LINKED_AT,
  },
};

const WALLET = 'wallets/uid-camila';
const LEDGER = `${WALLET}/ledger/mission:seed-camila-4`;
const CENTRAL = `${WALLET}/centralPoints/nettobrito`;
const OTHER_WALLET = 'wallets/uid-alan';
const STATS_DAY = 'statsDaily/2026-10-05';
const STATS_SHARD = `${STATS_DAY}/statsShards/7`;

/** Equipe e os documentos do núcleo de pontos, como o servidor grava. */
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
    const now = Timestamp.now();
    for (const path of [WALLET, OTHER_WALLET]) {
      await setDoc(doc(db, path), {
        uid: path.split('/')[1],
        balance: 12_480,
        xp: 12_480,
        seasonId: 'temporada-sao-joao',
        seasonPoints: 4_120,
        seasonPointsAt: now,
        earnedTotal: 840,
        spentTotal: 0,
        days: {},
        stats: { pastSeasons: 2 },
        activity: { lastDay: null, lastWeek: null, lastMonth: null },
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    await setDoc(doc(db, LEDGER), {
      uid: 'uid-camila',
      kind: 'earn',
      source: 'mission',
      points: 100,
    });
    await setDoc(doc(db, CENTRAL), {
      uid: 'uid-camila',
      artistId: 'nettobrito',
      totalPoints: 4_120,
    });
    await setDoc(doc(db, 'config/points'), { version: 1, values: { comment: 2 } });
    await setDoc(doc(db, 'config/points/versions/1'), { version: 1 });
    await setDoc(doc(db, 'config/season'), { version: 1, season: null });
    await setDoc(doc(db, 'config/season/versions/1'), { version: 1 });
    await setDoc(doc(db, 'config/segredo'), { chave: 'só do servidor' });
    await setDoc(doc(db, 'config/segredo/versions/1'), { chave: 'só do servidor' });
    await setDoc(doc(db, STATS_DAY), { day: '2026-10-05', closed: true });
    await setDoc(doc(db, STATS_SHARD), { day: '2026-10-05', totals: { earned: 2 } });
    await setDoc(doc(db, 'statsMeta/close'), { lastClosedDay: '2026-10-04' });
    await setDoc(doc(db, 'idempotency/abc'), { uid: 'uid-camila', status: 200, body: {} });
  });
}

type Db = ReturnType<RulesTestContext['firestore']>;

const as = (uid: string, authTime?: number) =>
  env
    .authenticatedContext(uid, authTime === undefined ? undefined : { auth_time: authTime })
    .firestore();
const anonymous = () => env.unauthenticatedContext().firestore();

/** Lê (get e list) a carteira, o extrato e os pontos por central de dois fãs. */
async function readsWallets(db: Db, outcome: 'succeeds' | 'fails'): Promise<void> {
  const check = outcome === 'succeeds' ? assertSucceeds : assertFails;
  await check(getDoc(doc(db, WALLET)));
  await check(getDoc(doc(db, OTHER_WALLET)));
  await check(getDocs(collection(db, 'wallets')));
  await check(getDoc(doc(db, LEDGER)));
  await check(getDocs(collection(db, `${WALLET}/ledger`)));
  await check(getDoc(doc(db, CENTRAL)));
  await check(getDocs(collection(db, `${WALLET}/centralPoints`)));
}

async function readsStats(db: Db, outcome: 'succeeds' | 'fails'): Promise<void> {
  const check = outcome === 'succeeds' ? assertSucceeds : assertFails;
  await check(getDoc(doc(db, STATS_DAY)));
  await check(getDocs(collection(db, 'statsDaily')));
  await check(getDoc(doc(db, STATS_SHARD)));
  await check(getDocs(collection(db, `${STATS_DAY}/statsShards`)));
}

async function readsConfig(db: Db, outcome: 'succeeds' | 'fails'): Promise<void> {
  const check = outcome === 'succeeds' ? assertSucceeds : assertFails;
  await check(getDoc(doc(db, 'config/points')));
  await check(getDoc(doc(db, 'config/season')));
  await check(getDoc(doc(db, 'config/points/versions/1')));
  await check(getDocs(collection(db, 'config/season/versions')));
}

/** Nenhuma gravação nas coleções novas passa, nem criar, nem mudar, nem apagar. */
async function writesNothing(db: Db): Promise<void> {
  await assertFails(setDoc(doc(db, 'wallets/uid-novo'), { balance: 1 }));
  await assertFails(updateDoc(doc(db, WALLET), { balance: 999_999 }));
  await assertFails(deleteDoc(doc(db, WALLET)));
  await assertFails(setDoc(doc(db, `${WALLET}/ledger/like:p1`), { points: 1 }));
  await assertFails(deleteDoc(doc(db, LEDGER)));
  await assertFails(updateDoc(doc(db, CENTRAL), { totalPoints: 1 }));
  await assertFails(setDoc(doc(db, 'config/points'), { version: 2 }));
  await assertFails(setDoc(doc(db, 'config/season/versions/2'), { version: 2 }));
  await assertFails(setDoc(doc(db, STATS_SHARD), { totals: { earned: 1 } }));
  await assertFails(setDoc(doc(db, 'statsDaily/2026-10-06'), { closed: true }));
  await assertFails(setDoc(doc(db, 'statsMeta/close'), { lastClosedDay: '2026-10-05' }));
  await assertFails(setDoc(doc(db, 'idempotency/xyz'), { uid: 'x' }));
}

describe('carteira, extrato e pontos por central', () => {
  beforeEach(seed);

  it('o fã não lê a própria carteira direto (vem pela API), nem a de outro, e não grava', async () => {
    await readsWallets(as('uid-camila'), 'fails');
    await writesNothing(as('uid-camila'));
  });

  it('sem login não lê nada', async () => {
    await readsWallets(anonymous(), 'fails');
    await readsStats(anonymous(), 'fails');
    await readsConfig(anonymous(), 'fails');
  });

  it('equipe ativa com a seção fans (editora e leitor) e admin leem a de qualquer fã', async () => {
    for (const uid of ['admin', 'editora', 'leitor']) await readsWallets(as(uid), 'succeeds');
  });

  it('equipe sem fans, desativada, pendente ou com sessão de antes do authValidAfter não lê', async () => {
    for (const uid of ['semSecao', 'visaoGeral', 'desativada', 'pendente']) {
      await readsWallets(as(uid), 'fails');
    }
    await readsWallets(as('ligada', LINKED_AT - 1), 'fails');
    await readsWallets(as('ligada', LINKED_AT), 'succeeds');
  });

  it('ninguém grava, nem admin', async () => {
    for (const uid of ['admin', 'editora', 'leitor', 'uid-camila']) await writesNothing(as(uid));
  });
});

describe('configuração de pontos e temporada', () => {
  beforeEach(seed);

  it('equipe ativa lê, inclusive o leitor sem a seção', async () => {
    for (const uid of ['admin', 'editora', 'leitor', 'semSecao', 'visaoGeral']) {
      await readsConfig(as(uid), 'succeeds');
    }
    await readsConfig(as('ligada', LINKED_AT), 'succeeds');
  });

  it('fã, equipe inativa e sessão antiga não leem', async () => {
    for (const uid of ['uid-camila', 'desativada', 'pendente']) await readsConfig(as(uid), 'fails');
    await readsConfig(as('ligada', LINKED_AT - 1), 'fails');
  });

  it('outro documento em config/ e as versões dele: nem a equipe ativa lê, nem admin', async () => {
    for (const uid of ['admin', 'editora']) {
      await assertFails(getDoc(doc(as(uid), 'config/segredo')));
      await assertFails(getDoc(doc(as(uid), 'config/segredo/versions/1')));
      await assertFails(getDocs(collection(as(uid), 'config')));
    }
  });
});

describe('contadores agregados do painel', () => {
  beforeEach(seed);

  it('quem vê overview ou growth lê (get e list); admin também', async () => {
    for (const uid of ['visaoGeral', 'crescimento', 'admin']) await readsStats(as(uid), 'succeeds');
    await readsStats(as('ligada', LINKED_AT), 'succeeds');
  });

  it('quem só vê fans, outra seção, a equipe inativa e o fã não leem', async () => {
    for (const uid of ['editora', 'leitor', 'semSecao', 'desativada', 'pendente', 'uid-camila']) {
      await readsStats(as(uid), 'fails');
    }
    await readsStats(as('ligada', LINKED_AT - 1), 'fails');
  });
});

describe('controle do servidor', () => {
  beforeEach(seed);

  it('statsMeta e idempotency: ninguém lê nem grava, nem admin', async () => {
    for (const uid of ['admin', 'visaoGeral', 'editora', 'uid-camila']) {
      const db = as(uid);
      await assertFails(getDoc(doc(db, 'statsMeta/close')));
      await assertFails(getDocs(collection(db, 'statsMeta')));
      await assertFails(getDoc(doc(db, 'idempotency/abc')));
      await assertFails(getDocs(collection(db, 'idempotency')));
      await assertFails(setDoc(doc(db, 'idempotency/abc'), { uid }));
    }
  });
});
