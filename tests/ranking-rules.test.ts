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
  limit,
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regras das coleções do ranking e das temporadas (bloco 8,
 * docs/arquitetura-api.md, 23.12) contra o emulador. Rode com
 * `npm run test:rules`. O resultado congelado das temporadas (`seasons` e
 * `standings`) é da seção ranking; o andamento da virada e do retrato
 * (`rankingJobs`), de ninguém. Só o servidor grava. O fã recebe a temporada e
 * o ranking pela API, nunca direto. Os campos novos da carteira e do
 * `centralPoints` (`rankWeek`, `member`) seguem a regra deles (seção fans).
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
  editora: { role: 'editor', status: 'active', sections: ['ranking'] },
  leitor: { role: 'viewer', status: 'active', sections: ['ranking'] },
  fas: { role: 'editor', status: 'active', sections: ['fans'] },
  missoes: { role: 'editor', status: 'active', sections: ['missions'] },
  desativada: { role: 'editor', status: 'disabled', sections: ['ranking', 'fans'] },
  pendente: { role: 'admin', status: 'pending' },
  ligada: {
    role: 'editor',
    status: 'active',
    sections: ['ranking'],
    authValidAfter: LINKED_AT,
  },
};

const SEASON = 'seasons/temporada-carnaval';
const STANDING = `${SEASON}/standings/uid-camila`;
const OTHER_STANDING = `${SEASON}/standings/uid-alan`;
const JOB = 'rankingJobs/close-temporada-carnaval';
const WALLET = 'wallets/uid-camila';
const CENTRAL = `${WALLET}/centralPoints/nettobrito`;

/** Equipe, o arquivo de uma temporada e o andamento da virada, como o servidor grava. */
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
    await setDoc(doc(db, SEASON), {
      id: 'temporada-carnaval',
      name: 'Carnaval',
      status: 'closed',
      closedAt: now,
      rankedFans: 2,
      centrals: { nettobrito: { rankedFans: 1 } },
      schemaVersion: 1,
    });
    await setDoc(doc(db, STANDING), {
      uid: 'uid-camila',
      seasonId: 'temporada-carnaval',
      displayName: 'Camila Ribeiro',
      photoURL: null,
      city: 'Feira de Santana, BA',
      position: 36,
      points: 290,
      centrals: { nettobrito: { position: 1, points: 40 } },
    });
    await setDoc(doc(db, OTHER_STANDING), {
      uid: 'uid-alan',
      seasonId: 'temporada-carnaval',
      displayName: 'Alan Ferreira',
      photoURL: null,
      city: null,
      position: 1,
      points: 980,
      centrals: {},
    });
    await setDoc(doc(db, JOB), { kind: 'close', status: 'done', cursor: null });
    await setDoc(doc(db, WALLET), {
      uid: 'uid-camila',
      seasonId: 'temporada-sao-joao',
      seasonPoints: 4_120,
      stats: { pastSeasons: 2, closedSeasonId: 'temporada-carnaval' },
      rankWeek: { seasonId: 'temporada-sao-joao', week: '2026-W41', position: 14 },
    });
    await setDoc(doc(db, CENTRAL), {
      uid: 'uid-camila',
      artistId: 'nettobrito',
      member: true,
      rankWeek: { seasonId: 'temporada-sao-joao', week: '2026-W41', position: 12 },
    });
    await setDoc(doc(db, 'config/season'), {
      version: 4,
      season: null,
      next: { id: 'temporada-verao' },
      lastClosed: { id: 'temporada-carnaval' },
    });
  });
}

type Db = ReturnType<RulesTestContext['firestore']>;

const as = (uid: string, authTime?: number) =>
  env
    .authenticatedContext(uid, authTime === undefined ? undefined : { auth_time: authTime })
    .firestore();
const anonymous = () => env.unauthenticatedContext().firestore();

/** Lê (get e list) o cabeçalho e as linhas do arquivo, e o top N por posição, como o painel. */
async function readsArchive(db: Db, outcome: 'succeeds' | 'fails'): Promise<void> {
  const check = outcome === 'succeeds' ? assertSucceeds : assertFails;
  await check(getDoc(doc(db, SEASON)));
  await check(getDocs(collection(db, 'seasons')));
  await check(getDoc(doc(db, STANDING)));
  await check(getDocs(collection(db, `${SEASON}/standings`)));
  await check(
    getDocs(query(collection(db, `${SEASON}/standings`), orderBy('position'), limit(10))),
  );
  await check(
    getDocs(
      query(
        collection(db, `${SEASON}/standings`),
        orderBy('centrals.nettobrito.position'),
        limit(10),
      ),
    ),
  );
}

/** Nenhuma gravação no arquivo nem no andamento passa. */
async function writesNothing(db: Db): Promise<void> {
  await assertFails(setDoc(doc(db, 'seasons/temporada-verao'), { status: 'closed' }));
  await assertFails(updateDoc(doc(db, SEASON), { rankedFans: 999 }));
  await assertFails(deleteDoc(doc(db, SEASON)));
  await assertFails(setDoc(doc(db, `${SEASON}/standings/uid-novo`), { position: 1 }));
  await assertFails(updateDoc(doc(db, STANDING), { position: 1 }));
  await assertFails(deleteDoc(doc(db, OTHER_STANDING)));
  await assertFails(setDoc(doc(db, JOB), { status: 'running' }));
  await assertFails(setDoc(doc(db, 'rankingJobs/snapshot-x'), { status: 'running' }));
}

describe('resultado congelado das temporadas (seasons e standings)', () => {
  beforeEach(seed);

  it('a equipe ativa com a seção ranking (editora e leitor) e admin leem, também o top N', async () => {
    for (const uid of ['admin', 'editora', 'leitor']) await readsArchive(as(uid), 'succeeds');
    await readsArchive(as('ligada', LINKED_AT), 'succeeds');
  });

  it('sem a seção (só fans, só missions), desativada, pendente ou com sessão antiga não leem', async () => {
    for (const uid of ['fas', 'missoes', 'desativada', 'pendente']) {
      await readsArchive(as(uid), 'fails');
    }
    await readsArchive(as('ligada', LINKED_AT - 1), 'fails');
  });

  it('o fã não lê nem a própria linha (vem pela API), e sem login nada', async () => {
    await readsArchive(as('uid-camila'), 'fails');
    await assertFails(getDoc(doc(as('uid-camila'), STANDING)));
    await readsArchive(anonymous(), 'fails');
  });

  it('ninguém grava, nem admin', async () => {
    for (const uid of ['admin', 'editora', 'leitor', 'uid-camila']) await writesNothing(as(uid));
  });
});

describe('andamento da virada e do retrato (rankingJobs)', () => {
  beforeEach(seed);

  it('ninguém lê nem grava, nem admin', async () => {
    for (const uid of ['admin', 'editora', 'fas', 'uid-camila']) {
      const db = as(uid);
      await assertFails(getDoc(doc(db, JOB)));
      await assertFails(getDocs(collection(db, 'rankingJobs')));
      await assertFails(setDoc(doc(db, JOB), { status: 'running' }));
    }
  });
});

describe('o que já existia, com os campos novos', () => {
  beforeEach(seed);

  it('config/season (com a próxima e a última fechada) continua da equipe ativa', async () => {
    for (const uid of ['admin', 'editora', 'fas', 'missoes']) {
      await assertSucceeds(getDoc(doc(as(uid), 'config/season')));
    }
    await assertFails(getDoc(doc(as('uid-camila'), 'config/season')));
    await assertFails(getDoc(doc(as('desativada'), 'config/season')));
  });

  it('a carteira (rankWeek, stats) e o centralPoints (member, rankWeek) continuam só com fans', async () => {
    for (const path of [WALLET, CENTRAL]) {
      await assertSucceeds(getDoc(doc(as('fas'), path)));
      await assertSucceeds(getDoc(doc(as('admin'), path)));
      await assertFails(getDoc(doc(as('editora'), path)));
      await assertFails(getDoc(doc(as('uid-camila'), path)));
    }
    await assertFails(updateDoc(doc(as('admin'), CENTRAL), { member: false }));
    await assertFails(updateDoc(doc(as('uid-camila'), WALLET), { rankWeek: null }));
  });
});
