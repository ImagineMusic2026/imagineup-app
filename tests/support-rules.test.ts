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
 * Regras do Suporte dos Ajustes (docs/arquitetura-api.md, seção 38, 38.5)
 * contra o emulador. Rode com `npm run test:rules`. As mensagens: só a equipe
 * com a seção support lê e lista; ninguém grava pelo cliente, nem o fã que
 * mandou, nem a equipe (resolver é pela callable). O perfil de quem mandou: a
 * seção support lê um por um (o nome e o @ do card), sem listar.
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
  'fanClubs',
  'missions',
  'rewards',
  'moderation',
  'support',
  'audit',
];

type Member = { role: 'admin' | 'editor' | 'viewer'; status: string; sections?: string[] };

const MEMBERS: Record<string, Member> = {
  admin: { role: 'admin', status: 'active' },
  suporte: { role: 'editor', status: 'active', sections: ['support'] },
  leitorSuporte: { role: 'viewer', status: 'active', sections: ['support'] },
  moderacao: { role: 'editor', status: 'active', sections: ['moderation'] },
  desativada: { role: 'editor', status: 'disabled', sections: ['support'] },
};

const MESSAGE = 'supportMessages/msg-bia';

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
    await setDoc(doc(db, 'users/uid-bia'), {
      displayName: 'Bia Santos',
      username: 'biasantos',
      createdAt: Timestamp.now(),
    });
    await setDoc(doc(db, MESSAGE), {
      uid: 'uid-bia',
      kind: 'problem',
      text: 'A agenda fica em branco.',
      device: { platform: 'android', osVersion: '14', appVersion: '0.1.0', updateId: null },
      status: 'open',
      createdAt: Timestamp.now(),
      resolvedAt: null,
      resolvedBy: null,
      schemaVersion: 1,
    });
  });
});

const as = (uid: string | null): RulesTestContext =>
  uid ? env.authenticatedContext(uid) : env.unauthenticatedContext();

const openList = (context: RulesTestContext) =>
  getDocs(
    query(
      collection(context.firestore(), 'supportMessages'),
      where('status', '==', 'open'),
      orderBy('createdAt', 'desc'),
    ),
  );

describe('supportMessages (38.5)', () => {
  it('o admin, o editor e o Leitor com a seção support leem e listam', async () => {
    for (const uid of ['admin', 'suporte', 'leitorSuporte']) {
      await assertSucceeds(getDoc(doc(as(uid).firestore(), MESSAGE)));
      await assertSucceeds(openList(as(uid)));
    }
  });

  it('sem a seção, desativada, o fã que mandou e sem login: nada', async () => {
    for (const uid of ['moderacao', 'desativada', 'uid-bia', null]) {
      await assertFails(getDoc(doc(as(uid).firestore(), MESSAGE)));
      await assertFails(openList(as(uid)));
    }
  });

  it('ninguém grava pelo cliente, nem o admin', async () => {
    for (const uid of ['admin', 'suporte', 'uid-bia']) {
      const db = as(uid).firestore();
      await assertFails(updateDoc(doc(db, MESSAGE), { status: 'resolved' }));
      await assertFails(deleteDoc(doc(db, MESSAGE)));
      await assertFails(
        setDoc(doc(db, 'supportMessages/nova'), {
          uid: 'uid-bia',
          kind: 'idea',
          text: 'oi',
          status: 'open',
        }),
      );
    }
  });
});

describe('o perfil de quem mandou (38.5)', () => {
  it('a seção support lê o perfil um por um, sem listar', async () => {
    for (const uid of ['suporte', 'leitorSuporte']) {
      const db = as(uid).firestore();
      await assertSucceeds(getDoc(doc(db, 'users/uid-bia')));
      await assertFails(getDocs(collection(db, 'users')));
    }
  });

  it('sem a seção (outra que não lê perfil), não lê', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'staff/artistas'), {
        uid: 'artistas',
        email: 'artistas@imagine.music',
        displayName: 'artistas',
        role: 'editor',
        sections: ['artists'],
        status: 'active',
        accountCreatedByInvite: true,
        createdAt: Timestamp.now(),
      });
    });
    await assertFails(getDoc(doc(as('artistas').firestore(), 'users/uid-bia')));
    await assertFails(getDoc(doc(as('desativada').firestore(), 'users/uid-bia')));
  });
});
