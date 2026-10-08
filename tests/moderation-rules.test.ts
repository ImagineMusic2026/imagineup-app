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
  where,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regras da moderação do bloco 6 (docs/arquitetura-api.md, 21.11) contra o
 * emulador. Rode com `npm run test:rules`. Denúncias e a fila: só a equipe
 * com a seção moderation lê. Listas de bloqueio: ninguém pelo cliente, nem a
 * equipe (dizem quem bloqueou quem), nem o próprio fã.
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
  moderacao: { role: 'editor', status: 'active', sections: ['moderation'] },
  leitorModeracao: { role: 'viewer', status: 'active', sections: ['moderation'] },
  artistas: { role: 'editor', status: 'active', sections: ['artists'] },
  fas: { role: 'viewer', status: 'active', sections: ['fans'] },
  desativada: { role: 'editor', status: 'disabled', sections: ['moderation'] },
};

const REPORT = 'commentReports/seed-c-show-enzo_uid-alan';
const ITEM = 'moderationQueue/seed-c-show-enzo';
const BLOCKS = 'blockLists/uid-camila';

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
    const at = Timestamp.now();
    await setDoc(doc(db, REPORT), {
      commentId: 'seed-c-show-enzo',
      postId: 'p-show',
      artistId: 'nenho',
      commentAuthorUid: 'uid-enzo',
      reporterUid: 'uid-alan',
      reason: 'spam',
      createdAt: at,
    });
    await setDoc(doc(db, ITEM), {
      commentId: 'seed-c-show-enzo',
      postId: 'p-show',
      commentText: 'Promoção no meu perfil',
      reportCount: 1,
      status: 'open',
      lastReportedAt: at,
    });
    await setDoc(doc(db, BLOCKS), { uid: 'uid-camila', blocked: ['uid-enzo'] });
  });
});

type Db = ReturnType<RulesTestContext['firestore']>;

const as = (uid: string) => env.authenticatedContext(uid).firestore();

/** A fila como a Moderação lê (26.16): os abertos, os resolvidos e os itens de um fã. */
async function readsQueue(db: Db, outcome: 'succeeds' | 'fails'): Promise<void> {
  const check = outcome === 'succeeds' ? assertSucceeds : assertFails;
  await check(getDoc(doc(db, ITEM)));
  await check(
    getDocs(
      query(
        collection(db, 'moderationQueue'),
        where('status', '==', 'open'),
        orderBy('lastReportedAt', 'desc'),
      ),
    ),
  );
  await check(
    getDocs(
      query(
        collection(db, 'moderationQueue'),
        where('status', '==', 'resolved'),
        orderBy('resolvedAt', 'desc'),
      ),
    ),
  );
  await check(
    getDocs(
      query(
        collection(db, 'moderationQueue'),
        where('authorUid', '==', 'uid-enzo'),
        orderBy('lastReportedAt', 'desc'),
      ),
    ),
  );
}

/** As denúncias uma a uma: guardam quem denunciou. */
async function readsReports(db: Db): Promise<void> {
  await assertFails(getDoc(doc(db, REPORT)));
  await assertFails(
    getDocs(query(collection(db, 'commentReports'), where('commentId', '==', 'seed-c-show-enzo'))),
  );
  await assertFails(getDocs(collection(db, 'commentReports')));
}

describe('denúncias e a fila da Moderação', () => {
  it('só a equipe com moderation lê a fila (editora e leitora) e admin', async () => {
    for (const uid of ['admin', 'moderacao', 'leitorModeracao']) {
      await readsQueue(as(uid), 'succeeds');
    }
  });

  it('as denúncias uma a uma ficam fechadas para toda a equipe, até a Moderação e o admin (bloco 11)', async () => {
    for (const uid of ['admin', 'moderacao', 'leitorModeracao', 'fas', 'uid-alan']) {
      await readsReports(as(uid));
    }
  });

  it('o fã, outras seções e a desativada não leem a fila', async () => {
    for (const uid of ['uid-alan', 'uid-enzo', 'artistas', 'fas', 'desativada']) {
      await readsQueue(as(uid), 'fails');
    }
  });

  it('ninguém grava, nem admin', async () => {
    for (const uid of ['admin', 'moderacao', 'uid-alan']) {
      const db = as(uid);
      await assertFails(setDoc(doc(db, 'commentReports/c_uid'), { reason: 'spam' }));
      await assertFails(deleteDoc(doc(db, REPORT)));
      await assertFails(updateDoc(doc(db, ITEM), { status: 'resolved' }));
      await assertFails(setDoc(doc(db, 'moderationQueue/outro'), { reportCount: 1 }));
    }
  });
});

describe('listas de bloqueio', () => {
  it('ninguém lê pelo cliente: nem admin, nem a Moderação, nem o próprio fã', async () => {
    for (const uid of ['admin', 'moderacao', 'fas', 'uid-camila', 'uid-enzo']) {
      const db = as(uid);
      await assertFails(getDoc(doc(db, BLOCKS)));
      await assertFails(getDocs(collection(db, 'blockLists')));
    }
  });

  it('ninguém grava', async () => {
    for (const uid of ['admin', 'uid-camila']) {
      await assertFails(setDoc(doc(as(uid), BLOCKS), { blocked: [] }));
      await assertFails(deleteDoc(doc(as(uid), BLOCKS)));
    }
  });
});
