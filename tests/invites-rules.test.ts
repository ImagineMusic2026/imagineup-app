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
 * Regras do bloco 5 (docs/arquitetura-api.md, 20.9) contra o emulador. Rode
 * com `npm run test:rules`. O convite é só do servidor: o código de cada fã
 * (inviteCodes, com o ownerKey) e quem já contou como visitante
 * (fanInvites/{uid}/inviteVisitors) ninguém lê pelo cliente, nem admin; o
 * código do fã, os links dele (fanInvites, inviteLinks) e quem trouxe quem
 * (referrals) só a equipe com a seção fans lê. O fã recebe tudo pela API
 * (/me/invite e /me/progress), nem o próprio lê direto. Ninguém grava.
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

const CODE = 'inviteCodes/CAMILA12';
const FAN_INVITE = 'fanInvites/uid-camila';
const LINK = 'fanInvites/uid-camila/inviteLinks/post:p-clipe';
const VISITOR = 'fanInvites/uid-camila/inviteVisitors/e0123456789abcdef0123456789abcdef01234567';
const REFERRAL = 'referrals/uid-bia';
const OWN_REFERRAL = 'referrals/uid-camila';

/** Equipe, perfis e os documentos do bloco 5, como o servidor grava. */
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
    const at = Timestamp.now();
    for (const uid of ['uid-camila', 'uid-bia']) {
      await setDoc(doc(db, `users/${uid}`), {
        displayName: uid === 'uid-camila' ? 'Camila Ribeiro' : 'Bia Santos',
        username: uid === 'uid-camila' ? 'camilarib' : 'biasan',
        city: null,
        photoURL: null,
        createdAt: at,
      });
    }
    await setDoc(doc(db, CODE), {
      code: 'CAMILA12',
      kind: 'fan',
      uid: 'uid-camila',
      ownerKey: 'e0000000000000000000000000000000000000000',
      createdAt: at,
      schemaVersion: 1,
    });
    await setDoc(doc(db, FAN_INVITE), {
      uid: 'uid-camila',
      code: 'CAMILA12',
      createdAt: at,
      schemaVersion: 1,
    });
    await setDoc(doc(db, LINK), {
      uid: 'uid-camila',
      linkId: 'post:p-clipe',
      kind: 'post',
      targetId: 'p-clipe',
      createdAt: at,
    });
    await setDoc(doc(db, VISITOR), { via: 'claim', day: '2026-10-05', createdAt: at });
    for (const [path, uid, inviterUid] of [
      [REFERRAL, 'uid-bia', 'uid-camila'],
      [OWN_REFERRAL, 'uid-camila', 'uid-alan'],
    ] as const) {
      await setDoc(doc(db, path), {
        uid,
        inviterUid,
        code: 'CAMILA12',
        via: 'link',
        link: { kind: 'post', targetId: 'p-clipe' },
        utm: { source: 'instagram', medium: 'story', campaign: 'sao-joao' },
        openedAt: at,
        signupAt: at,
        claimedAt: at,
        day: '2026-10-05',
        award: { visit: 'applied', signup: 'applied' },
        inviterRemovedAt: null,
        schemaVersion: 1,
      });
    }
  });
}

type Db = ReturnType<RulesTestContext['firestore']>;

const as = (uid: string, authTime?: number) =>
  env
    .authenticatedContext(uid, authTime === undefined ? undefined : { auth_time: authTime })
    .firestore();
const anonymous = () => env.unauthenticatedContext().firestore();

/** O que a seção Fãs do painel lê: o código e os links do fã, e quem trouxe quem. */
async function readsInvites(db: Db, outcome: 'succeeds' | 'fails'): Promise<void> {
  const check = outcome === 'succeeds' ? assertSucceeds : assertFails;
  await check(getDoc(doc(db, FAN_INVITE)));
  await check(getDocs(query(collection(db, 'fanInvites'), where('code', '==', 'CAMILA12'))));
  await check(getDoc(doc(db, LINK)));
  await check(getDocs(collection(db, 'fanInvites/uid-camila/inviteLinks')));
  await check(getDoc(doc(db, REFERRAL)));
  await check(getDoc(doc(db, OWN_REFERRAL)));
  await check(getDocs(query(collection(db, 'referrals'), where('inviterUid', '==', 'uid-camila'))));
}

/** O código (com o ownerKey) e os marcadores de visita: ninguém lê pelo cliente. */
async function readsNothingSecret(db: Db): Promise<void> {
  await assertFails(getDoc(doc(db, CODE)));
  await assertFails(getDocs(collection(db, 'inviteCodes')));
  await assertFails(
    getDocs(query(collection(db, 'inviteCodes'), where('uid', '==', 'uid-camila'))),
  );
  await assertFails(getDoc(doc(db, VISITOR)));
  await assertFails(getDocs(collection(db, 'fanInvites/uid-camila/inviteVisitors')));
}

/** Nenhuma gravação passa: o convite é do servidor. */
async function writesNothing(db: Db): Promise<void> {
  await assertFails(
    setDoc(doc(db, 'inviteCodes/NOVO1234'), { uid: 'uid-camila', code: 'NOVO1234' }),
  );
  await assertFails(updateDoc(doc(db, CODE), { uid: 'uid-bia' }));
  await assertFails(deleteDoc(doc(db, CODE)));
  await assertFails(setDoc(doc(db, 'fanInvites/uid-bia'), { uid: 'uid-bia', code: 'X1234567' }));
  await assertFails(updateDoc(doc(db, FAN_INVITE), { code: 'OUTRO123' }));
  await assertFails(deleteDoc(doc(db, FAN_INVITE)));
  await assertFails(
    setDoc(doc(db, 'fanInvites/uid-camila/inviteLinks/invite'), { kind: 'invite' }),
  );
  await assertFails(deleteDoc(doc(db, LINK)));
  await assertFails(setDoc(doc(db, 'fanInvites/uid-camila/inviteVisitors/u1'), { via: 'visit' }));
  await assertFails(deleteDoc(doc(db, VISITOR)));
  await assertFails(setDoc(doc(db, 'referrals/uid-novo'), { uid: 'uid-novo', inviterUid: 'x' }));
  await assertFails(updateDoc(doc(db, REFERRAL), { inviterUid: 'uid-bia' }));
  await assertFails(deleteDoc(doc(db, REFERRAL)));
}

describe('convite (inviteCodes, fanInvites e referrals)', () => {
  beforeEach(seed);

  it('o fã não lê nem o próprio convite nem quem o trouxe (vem pela API), e não grava', async () => {
    await readsInvites(as('uid-camila'), 'fails');
    await readsInvites(as('uid-bia'), 'fails');
    await readsNothingSecret(as('uid-camila'));
    await writesNothing(as('uid-camila'));
    await writesNothing(as('uid-bia'));
  });

  it('sem login não lê nada', async () => {
    await readsInvites(anonymous(), 'fails');
    await readsNothingSecret(anonymous());
  });

  it('equipe ativa com a seção fans (editora e leitor) e admin leem, também por consulta', async () => {
    for (const uid of ['admin', 'editora', 'leitor']) await readsInvites(as(uid), 'succeeds');
    await readsInvites(as('ligada', LINKED_AT), 'succeeds');
  });

  it('equipe sem fans (só artists), desativada, pendente ou com sessão de antes do authValidAfter não lê', async () => {
    for (const uid of ['artistas', 'desativada', 'pendente']) {
      await readsInvites(as(uid), 'fails');
    }
    await readsInvites(as('ligada', LINKED_AT - 1), 'fails');
  });

  it('o código e os marcadores de visita: ninguém lê, nem admin nem a equipe com fans', async () => {
    for (const uid of ['admin', 'editora', 'leitor', 'artistas']) {
      await readsNothingSecret(as(uid));
    }
    await readsNothingSecret(as('ligada', LINKED_AT));
  });

  it('ninguém grava, nem admin', async () => {
    for (const uid of ['admin', 'editora', 'leitor', 'artistas']) await writesNothing(as(uid));
  });
});
