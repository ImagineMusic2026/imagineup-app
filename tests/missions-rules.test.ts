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
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regras das coleções do bloco 7 (docs/arquitetura-api.md, 22.10) contra o
 * emulador: o catálogo de missões com a meta da temporada (config/missions e
 * as versões), o arquivo das missões (missionArchive) e o catálogo de
 * conquistas (config/achievements e as versões). Só o servidor grava; a seção
 * missions lê tudo, a Visão geral lê o catálogo e o arquivo das missões (os
 * títulos das conclusões) e a seção Fãs lê os catálogos de agora e o arquivo
 * (os nomes do progresso e das conquistas da carteira), sem as versões. O fã
 * recebe tudo pela API. Rode com `npm run test:rules`.
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
  missoes: { role: 'editor', status: 'active', sections: ['missions'] },
  leitorMissoes: { role: 'viewer', status: 'active', sections: ['missions'] },
  visaoGeral: { role: 'viewer', status: 'active', sections: ['overview'] },
  fas: { role: 'editor', status: 'active', sections: ['fans'] },
  ranking: { role: 'editor', status: 'active', sections: ['ranking'] },
  desativada: { role: 'editor', status: 'disabled', sections: ['missions', 'overview'] },
  pendente: { role: 'admin', status: 'pending' },
  ligada: {
    role: 'editor',
    status: 'active',
    sections: ['missions'],
    authValidAfter: LINKED_AT,
  },
};

const MISSIONS = 'config/missions';
const MISSIONS_VERSION = 'config/missions/versions/1';
const ARCHIVE = 'missionArchive/m-relampago-show';
const ACHIEVEMENTS = 'config/achievements';
const ACHIEVEMENTS_VERSION = 'config/achievements/versions/1';
const STATS_DAY = 'statsDaily/2026-10-05';
const STATS_SHARD = `${STATS_DAY}/statsShards/7`;

/** A equipe e os documentos do bloco 7, como o servidor grava. */
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
    const catalog = { version: 1, missions: [{ id: 'm-clipe-netto' }], seasonGoal: null };
    await setDoc(doc(db, MISSIONS), catalog);
    await setDoc(doc(db, MISSIONS_VERSION), catalog);
    await setDoc(doc(db, ARCHIVE), {
      id: 'm-relampago-show',
      status: 'archived',
      archivedAt: Timestamp.now(),
    });
    const achievements = { version: 1, achievements: [{ id: 'boca-a-boca' }] };
    await setDoc(doc(db, ACHIEVEMENTS), achievements);
    await setDoc(doc(db, ACHIEVEMENTS_VERSION), achievements);
    await setDoc(doc(db, 'config/points'), { version: 1 });
    await setDoc(doc(db, 'config/season'), { version: 1, season: null });
    await setDoc(doc(db, 'config/segredo'), { chave: 'só do servidor' });
    await setDoc(doc(db, STATS_DAY), { day: '2026-10-05' });
    await setDoc(doc(db, STATS_SHARD), { byMission: { 'm-clipe-netto': { completed: 1 } } });
  });
}

type Db = ReturnType<RulesTestContext['firestore']>;

const as = (uid: string, authTime?: number) =>
  env
    .authenticatedContext(uid, authTime === undefined ? undefined : { auth_time: authTime })
    .firestore();
const anonymous = () => env.unauthenticatedContext().firestore();

type Outcome = 'succeeds' | 'fails';
const check = (outcome: Outcome) => (outcome === 'succeeds' ? assertSucceeds : assertFails);

/** O catálogo de missões, as versões e o arquivo (get e list). */
async function readsMissions(db: Db, outcome: Outcome): Promise<void> {
  const run = check(outcome);
  await run(getDoc(doc(db, MISSIONS)));
  await run(getDoc(doc(db, MISSIONS_VERSION)));
  await run(getDocs(collection(db, 'config/missions/versions')));
  await run(getDoc(doc(db, ARCHIVE)));
  await run(getDocs(query(collection(db, 'missionArchive'), orderBy('archivedAt', 'desc'))));
}

/** Só o que a seção Fãs lê: o catálogo de missões de agora, o arquivo e o de conquistas. */
async function readsCurrentCatalogs(db: Db, outcome: Outcome): Promise<void> {
  const run = check(outcome);
  await run(getDoc(doc(db, MISSIONS)));
  await run(getDoc(doc(db, ARCHIVE)));
  await run(getDocs(query(collection(db, 'missionArchive'), orderBy('archivedAt', 'desc'))));
  await run(getDoc(doc(db, ACHIEVEMENTS)));
}

/** As versões dos dois catálogos (get e list). */
async function readsVersions(db: Db, outcome: Outcome): Promise<void> {
  const run = check(outcome);
  await run(getDoc(doc(db, MISSIONS_VERSION)));
  await run(getDocs(collection(db, 'config/missions/versions')));
  await run(getDoc(doc(db, ACHIEVEMENTS_VERSION)));
  await run(getDocs(collection(db, 'config/achievements/versions')));
}

async function readsAchievements(db: Db, outcome: Outcome): Promise<void> {
  const run = check(outcome);
  await run(getDoc(doc(db, ACHIEVEMENTS)));
  await run(getDoc(doc(db, ACHIEVEMENTS_VERSION)));
  await run(getDocs(collection(db, 'config/achievements/versions')));
}

async function readsStats(db: Db, outcome: Outcome): Promise<void> {
  const run = check(outcome);
  await run(getDoc(doc(db, STATS_DAY)));
  await run(getDocs(collection(db, 'statsDaily')));
  await run(getDoc(doc(db, STATS_SHARD)));
  await run(getDocs(collection(db, `${STATS_DAY}/statsShards`)));
}

/** Nenhuma gravação passa: criar, mudar ou apagar o catálogo, as versões e o arquivo. */
async function writesNothing(db: Db): Promise<void> {
  await assertFails(setDoc(doc(db, MISSIONS), { version: 2, missions: [] }));
  await assertFails(updateDoc(doc(db, MISSIONS), { version: 2 }));
  await assertFails(deleteDoc(doc(db, MISSIONS)));
  await assertFails(setDoc(doc(db, 'config/missions/versions/2'), { version: 2 }));
  await assertFails(setDoc(doc(db, 'missionArchive/m-nova'), { id: 'm-nova' }));
  await assertFails(deleteDoc(doc(db, ARCHIVE)));
  await assertFails(setDoc(doc(db, ACHIEVEMENTS), { version: 2, achievements: [] }));
  await assertFails(setDoc(doc(db, 'config/achievements/versions/2'), { version: 2 }));
  await assertFails(setDoc(doc(db, STATS_SHARD), { byMission: {} }));
}

describe('catálogo de missões, versões e arquivo', () => {
  beforeEach(seed);

  it('a equipe ativa com missions (editora e leitor), com overview, e admin leem', async () => {
    for (const uid of ['admin', 'missoes', 'leitorMissoes', 'visaoGeral']) {
      await readsMissions(as(uid), 'succeeds');
    }
    await readsMissions(as('ligada', LINKED_AT), 'succeeds');
  });

  it('sem missions nem overview (só ranking), desativada, pendente ou sessão antiga não leem', async () => {
    for (const uid of ['ranking', 'desativada', 'pendente']) {
      await readsMissions(as(uid), 'fails');
    }
    await readsMissions(as('ligada', LINKED_AT - 1), 'fails');
  });

  it('a seção Fãs lê o catálogo de agora e o arquivo, e não as versões', async () => {
    await readsCurrentCatalogs(as('fas'), 'succeeds');
    await readsVersions(as('fas'), 'fails');
  });

  it('o fã e quem não está logado não leem', async () => {
    await readsMissions(as('uid-camila'), 'fails');
    await readsMissions(anonymous(), 'fails');
  });

  it('ninguém grava, nem admin', async () => {
    for (const uid of ['admin', 'missoes', 'visaoGeral', 'fas', 'uid-camila'])
      await writesNothing(as(uid));
  });
});

describe('catálogo de conquistas e versões', () => {
  beforeEach(seed);

  it('só com missions (e admin); a seção Fãs lê o de agora, sem as versões', async () => {
    for (const uid of ['admin', 'missoes', 'leitorMissoes']) {
      await readsAchievements(as(uid), 'succeeds');
    }
    await readsAchievements(as('ligada', LINKED_AT), 'succeeds');
    await assertSucceeds(getDoc(doc(as('fas'), ACHIEVEMENTS)));
    await assertFails(getDoc(doc(as('fas'), ACHIEVEMENTS_VERSION)));
  });

  it('com overview sozinha não, nem o resto', async () => {
    for (const uid of ['visaoGeral', 'ranking', 'desativada', 'pendente', 'uid-camila']) {
      await readsAchievements(as(uid), 'fails');
    }
    await readsAchievements(as('ligada', LINKED_AT - 1), 'fails');
    await readsAchievements(anonymous(), 'fails');
  });
});

describe('contadores do painel e o resto de config/', () => {
  beforeEach(seed);

  it('a seção missions passa a ler os shards, ao lado de overview e growth', async () => {
    for (const uid of ['missoes', 'leitorMissoes', 'visaoGeral', 'admin']) {
      await readsStats(as(uid), 'succeeds');
    }
    for (const uid of ['fas', 'ranking', 'desativada', 'uid-camila']) {
      await readsStats(as(uid), 'fails');
    }
  });

  it('config/points e config/season seguem para a equipe ativa; outro id de config/ e a lista, para ninguém', async () => {
    for (const uid of ['missoes', 'fas', 'ranking']) {
      await assertSucceeds(getDoc(doc(as(uid), 'config/points')));
      await assertSucceeds(getDoc(doc(as(uid), 'config/season')));
    }
    for (const uid of ['admin', 'missoes']) {
      await assertFails(getDoc(doc(as(uid), 'config/segredo')));
      await assertFails(getDocs(collection(as(uid), 'config')));
    }
  });
});
