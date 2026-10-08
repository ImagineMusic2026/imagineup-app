import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regras do bloco 4 (docs/arquitetura-api.md, seção 19.10) contra o emulador.
 * Rode com `npm run test:rules`. O vínculo do fã com as centrais
 * (users/{uid}/centrals) e os shards do fanCount (artistStats) são só do
 * servidor: o fã recebe tudo pela API, nem o próprio vínculo lê direto. A
 * equipe com a seção fans lê os vínculos (seção Fãs do painel), também pelo
 * grupo de coleção; os shards, ninguém pelo cliente.
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
  artistas: { role: 'editor', status: 'active', sections: ['artists'] },
  desativada: { role: 'editor', status: 'disabled', sections: ['fans', 'artists'] },
  pendente: { role: 'admin', status: 'pending' },
  ligada: { role: 'editor', status: 'active', sections: ['fans'], authValidAfter: LINKED_AT },
};

const MEMBERSHIP = 'users/uid-camila/centrals/nettobrito';
const OTHER_MEMBERSHIP = 'users/uid-alan/centrals/nettobrito';
const SHARD = 'artistStats/nettobrito/fanShards/3';
const ROOT_CENTRAL = 'centrals/nettobrito';

/** Equipe, perfis e os documentos do bloco 4, como o servidor grava. */
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
    for (const uid of ['uid-camila', 'uid-alan']) {
      await setDoc(doc(db, `users/${uid}`), {
        displayName: uid === 'uid-camila' ? 'Camila Ribeiro' : 'Alan Ferreira',
        username: uid === 'uid-camila' ? 'camilarib' : 'alanfer',
        city: null,
        photoURL: null,
        createdAt: Timestamp.now(),
      });
    }
    const joinedAt = Timestamp.now();
    for (const path of [MEMBERSHIP, OTHER_MEMBERSHIP, 'users/uid-camila/centrals/nenho']) {
      const [, uid, , artistId] = path.split('/');
      await setDoc(doc(db, path), { uid, artistId, via: 'page', joinedAt, schemaVersion: 1 });
    }
    await setDoc(doc(db, SHARD), { count: 2, updatedAt: joinedAt });
    await setDoc(doc(db, 'artistStats/nettobrito'), { total: 2 });
    // Uma coleção de raiz chamada centrals, que nenhum código cria (19.10).
    await setDoc(doc(db, ROOT_CENTRAL), { artistId: 'nettobrito' });
  });
}

type Db = ReturnType<RulesTestContext['firestore']>;

const as = (uid: string, authTime?: number) =>
  env
    .authenticatedContext(uid, authTime === undefined ? undefined : { auth_time: authTime })
    .firestore();
const anonymous = () => env.unauthenticatedContext().firestore();

/** Lê os vínculos: o documento, a subcoleção de um fã e os fãs de uma central pelo grupo. */
async function readsMemberships(db: Db, outcome: 'succeeds' | 'fails'): Promise<void> {
  const check = outcome === 'succeeds' ? assertSucceeds : assertFails;
  await check(getDoc(doc(db, MEMBERSHIP)));
  await check(getDoc(doc(db, OTHER_MEMBERSHIP)));
  await check(getDocs(collection(db, 'users/uid-camila/centrals')));
  await check(
    getDocs(query(collectionGroup(db, 'centrals'), where('artistId', '==', 'nettobrito'))),
  );
}

/** Nenhuma gravação passa: vínculo e shards são do servidor. */
async function writesNothing(db: Db): Promise<void> {
  await assertFails(
    setDoc(doc(db, 'users/uid-camila/centrals/juninhomoraes'), {
      uid: 'uid-camila',
      artistId: 'juninhomoraes',
    }),
  );
  await assertFails(updateDoc(doc(db, MEMBERSHIP), { via: 'onboarding' }));
  await assertFails(deleteDoc(doc(db, MEMBERSHIP)));
  await assertFails(setDoc(doc(db, SHARD), { count: 100 }));
  await assertFails(setDoc(doc(db, 'artistStats/nettobrito/fanShards/9'), { count: 1 }));
  await assertFails(deleteDoc(doc(db, SHARD)));
  await assertFails(setDoc(doc(db, 'artistStats/nettobrito'), { total: 9 }));
  await assertFails(setDoc(doc(db, ROOT_CENTRAL), { artistId: 'outro' }));
}

describe('vínculo do fã com as centrais (users/{uid}/centrals)', () => {
  beforeEach(seed);

  it('o fã não lê nem o próprio vínculo (vem pela API), nem o de outro, e não grava', async () => {
    await readsMemberships(as('uid-camila'), 'fails');
    await writesNothing(as('uid-camila'));
  });

  it('sem login não lê nada', async () => {
    await readsMemberships(anonymous(), 'fails');
  });

  it('equipe ativa com a seção fans (editora e leitor) e admin leem, também pelo grupo', async () => {
    for (const uid of ['admin', 'editora', 'leitor']) await readsMemberships(as(uid), 'succeeds');
    await readsMemberships(as('ligada', LINKED_AT), 'succeeds');
  });

  it('equipe sem fans (só artists), desativada, pendente ou com sessão de antes do authValidAfter não lê', async () => {
    for (const uid of ['artistas', 'desativada', 'pendente']) {
      await readsMemberships(as(uid), 'fails');
    }
    await readsMemberships(as('ligada', LINKED_AT - 1), 'fails');
  });

  it('ninguém grava, nem admin', async () => {
    for (const uid of ['admin', 'editora', 'leitor', 'artistas']) await writesNothing(as(uid));
  });
});

describe('shards do fanCount (artistStats)', () => {
  beforeEach(seed);

  it('ninguém lê pelo cliente: nem a equipe com artists, nem admin, nem o fã', async () => {
    for (const uid of ['admin', 'artistas', 'editora', 'uid-camila']) {
      const db = as(uid);
      await assertFails(getDoc(doc(db, SHARD)));
      await assertFails(getDocs(collection(db, 'artistStats/nettobrito/fanShards')));
      await assertFails(getDoc(doc(db, 'artistStats/nettobrito')));
      await assertFails(getDocs(collection(db, 'artistStats')));
      await assertFails(getDocs(collectionGroup(db, 'fanShards')));
    }
  });
});

describe('a regra de grupo de centrals', () => {
  beforeEach(seed);

  // A regra do grupo alcança qualquer coleção chamada centrals, em qualquer
  // profundidade, e regra não é filtro: conferir o uid nela recusaria a
  // consulta do painel inteira. Por isso nenhuma outra coleção pode ter esse
  // nome; este teste deixa o alcance escrito.
  it('uma coleção de raiz centrals fica legível para a equipe com fans, e só para ela', async () => {
    await assertSucceeds(getDoc(doc(as('leitor'), ROOT_CENTRAL)));
    await assertFails(getDoc(doc(as('uid-camila'), ROOT_CENTRAL)));
    await assertFails(getDoc(doc(as('artistas'), ROOT_CENTRAL)));
  });
});

describe('o perfil e o vínculo com as centrais', () => {
  beforeEach(seed);

  it('o fã lê o próprio perfil, não o de outro; a equipe com fans lê perfis desde o bloco 11, e a com só artists não', async () => {
    await assertSucceeds(getDoc(doc(as('uid-camila'), 'users/uid-camila')));
    await assertFails(getDoc(doc(as('uid-camila'), 'users/uid-alan')));
    await assertSucceeds(getDoc(doc(as('editora'), 'users/uid-camila')));
    await assertFails(getDoc(doc(as('artistas'), 'users/uid-camila')));
    // Desde o perfil novo (docs/arquitetura-api.md, seção 28), o nome vai pela
    // API: o fã com nome não grava o próprio perfil pelo celular.
    await assertFails(
      updateDoc(doc(as('uid-camila'), 'users/uid-camila'), {
        displayName: 'Camila R.',
        updatedAt: serverTimestamp(),
      }),
    );
  });
});
