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
 * Regras da agenda do bloco 6 (docs/arquitetura-api.md, 21.11) contra o
 * emulador. Rode com `npm run test:rules`. Os shows são só do servidor (as
 * callables do painel): o fã recebe a agenda pela API; a equipe com artists,
 * moderation ou fans lê, também os rascunhos.
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

type Member = { role: 'admin' | 'editor' | 'viewer'; status: string; sections?: string[] };

const MEMBERS: Record<string, Member> = {
  admin: { role: 'admin', status: 'active' },
  artistas: { role: 'viewer', status: 'active', sections: ['artists'] },
  moderacao: { role: 'editor', status: 'active', sections: ['moderation'] },
  fas: { role: 'viewer', status: 'active', sections: ['fans'] },
  semSecao: { role: 'editor', status: 'active', sections: ['growth'] },
  desativada: { role: 'editor', status: 'disabled', sections: ['artists'] },
};

beforeEach(async () => {
  await env.clearFirestore();
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
        accountCreatedByInvite: true,
        createdAt: Timestamp.now(),
      });
    }
    const startsAt = Timestamp.fromMillis(Date.now() + 10 * 24 * 60 * 60 * 1000);
    await setDoc(doc(db, 'events/sao-joao-irara'), {
      title: 'São João de Irará',
      artistIds: ['nettobrito', 'nenho'],
      status: 'published',
      startsAt,
      featured: true,
    });
    await setDoc(doc(db, 'events/show-rascunho'), {
      title: 'Rascunho',
      artistIds: ['nettobrito'],
      status: 'draft',
      startsAt,
    });
  });
});

type Db = ReturnType<RulesTestContext['firestore']>;

const as = (uid: string) => env.authenticatedContext(uid).firestore();

async function readsEvents(db: Db, outcome: 'succeeds' | 'fails'): Promise<void> {
  const check = outcome === 'succeeds' ? assertSucceeds : assertFails;
  await check(getDoc(doc(db, 'events/sao-joao-irara')));
  await check(getDoc(doc(db, 'events/show-rascunho')));
  await check(getDocs(query(collection(db, 'events'), orderBy('startsAt'))));
}

describe('shows da agenda (events)', () => {
  it('o fã e quem não entrou não leem (a agenda vem pela API)', async () => {
    await readsEvents(as('uid-camila'), 'fails');
    await readsEvents(env.unauthenticatedContext().firestore(), 'fails');
  });

  it('a equipe com artists, moderation ou fans lê, também os rascunhos', async () => {
    for (const uid of ['admin', 'artistas', 'moderacao', 'fas']) {
      await readsEvents(as(uid), 'succeeds');
    }
  });

  it('sem essas seções, ou desativada, não lê', async () => {
    for (const uid of ['semSecao', 'desativada']) await readsEvents(as(uid), 'fails');
  });

  it('ninguém grava, nem admin', async () => {
    for (const uid of ['admin', 'artistas', 'uid-camila']) {
      const db = as(uid);
      await assertFails(setDoc(doc(db, 'events/novo'), { title: 'Novo' }));
      await assertFails(updateDoc(doc(db, 'events/sao-joao-irara'), { featured: false }));
      await assertFails(deleteDoc(doc(db, 'events/show-rascunho')));
    }
  });
});
