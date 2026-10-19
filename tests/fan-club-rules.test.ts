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
 * Regras do fã-clube gerido pelo fã (docs/arquitetura-api.md, seção 34, 34.6
 * e 34.13) contra o emulador. Rode com `npm run test:rules`. A seção
 * fanClubs (o editor, o Leitor e o admin) lê a candidatura, o fã-clube com os
 * prêmios, os números, as publicações e a fila das denúncias; o privado da
 * candidatura, só quem edita; as denúncias uma a uma, ninguém; o vínculo de
 * seguir e o marcador do crédito, só a seção Fãs, também pelo grupo. Ninguém
 * grava pelo cliente, nem o próprio fã, que lê tudo pela API. O contato do fã
 * (`users/{uid}/contact/main`, o WhatsApp da seção 35): quem edita a seção
 * lê o documento pelo caminho, na ficha da candidatura; o Leitor, a seção
 * Fãs e o próprio fã, não; ninguém lista.
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
  'audit',
];

type Member = { role: 'admin' | 'editor' | 'viewer'; status: string; sections?: string[] };

const MEMBERS: Record<string, Member> = {
  admin: { role: 'admin', status: 'active' },
  faClubes: { role: 'editor', status: 'active', sections: ['fanClubs'] },
  leitorFaClubes: { role: 'viewer', status: 'active', sections: ['fanClubs'] },
  fas: { role: 'viewer', status: 'active', sections: ['fans'] },
  artistas: { role: 'editor', status: 'active', sections: ['artists'] },
  desativada: { role: 'editor', status: 'disabled', sections: ['fanClubs', 'fans'] },
};

const GESTOR = 'uid-camila';
const FOLLOWER = 'uid-bia';
const CLUB = 'clube-camila';

const APPLICATION = `fanClubApplications/${GESTOR}`;
const PRIVATE = `fanClubApplicationPrivate/${GESTOR}`;
const FAN_CLUB = `fanClubs/${CLUB}`;
const PRIZE = `fanClubs/${CLUB}/prizes/premio-1`;
const SHARD = `fanClubStats/${CLUB}/fanClubShards/3`;
const POST = 'fanClubPosts/publicacao-1';
const REPORT = `fanClubReports/${FOLLOWER}_publicacao-1`;
const QUEUE = 'fanClubReportQueue/publicacao-1';
const FOLLOW = `users/${FOLLOWER}/fanClubFollows/${CLUB}`;
const CREDIT = `users/${FOLLOWER}/fanClubCredits/nettobrito`;
const CONTACT = `users/${GESTOR}/contact/main`;

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
    await setDoc(doc(db, APPLICATION), {
      uid: GESTOR,
      artistId: 'nettobrito',
      status: 'approved',
      round: 1,
      submittedAt: at,
      decidedAt: at,
      clubId: CLUB,
    });
    await setDoc(doc(db, PRIVATE), { instagram: 'camila.teste.up', tiktok: null, pitch: null });
    await setDoc(doc(db, FAN_CLUB), {
      artistId: 'nettobrito',
      ownerUid: GESTOR,
      name: 'Netto de Coração',
      status: 'active',
      approvedAt: at,
      counts: { followers: 1, followers30d: 1, at: null },
    });
    await setDoc(doc(db, PRIZE), { grantId: 'premio-1', points: 200, note: 'Bom trabalho' });
    await setDoc(doc(db, SHARD), { joins: 1, links: 0, visits: 0, signups: 0 });
    await setDoc(doc(db, POST), {
      clubId: CLUB,
      authorUid: GESTOR,
      status: 'pending',
      submittedAt: at,
    });
    await setDoc(doc(db, REPORT), { postId: 'publicacao-1', reporterUid: FOLLOWER, round: 1 });
    await setDoc(doc(db, QUEUE), {
      postId: 'publicacao-1',
      clubId: CLUB,
      status: 'open',
      lastReportedAt: at,
    });
    await setDoc(doc(db, `users/${FOLLOWER}`), { displayName: 'Bia Santos', username: 'biasan' });
    await setDoc(doc(db, FOLLOW), {
      uid: FOLLOWER,
      clubId: CLUB,
      artistId: 'nettobrito',
      followedAt: at,
      newAccount: false,
      chosenUsername: true,
      byOwnerCode: false,
    });
    await setDoc(doc(db, CREDIT), { artistId: 'nettobrito', clubId: CLUB, via: 'follow' });
    await setDoc(doc(db, CONTACT), {
      whatsapp: '+5575991234567',
      source: 'fanclub',
      updatedAt: at,
    });
  });
});

type Db = ReturnType<RulesTestContext['firestore']>;

const as = (uid: string) => env.authenticatedContext(uid).firestore();

/** O que a seção Fã-clubes lê: os documentos e as consultas das telas (34.10). */
async function readsSection(db: Db, outcome: 'succeeds' | 'fails'): Promise<void> {
  const check = outcome === 'succeeds' ? assertSucceeds : assertFails;
  await check(getDoc(doc(db, APPLICATION)));
  await check(
    getDocs(
      query(
        collection(db, 'fanClubApplications'),
        where('status', '==', 'pending'),
        orderBy('submittedAt'),
      ),
    ),
  );
  await check(getDoc(doc(db, FAN_CLUB)));
  await check(
    getDocs(
      query(
        collection(db, 'fanClubs'),
        where('status', '==', 'active'),
        orderBy('counts.followers', 'desc'),
      ),
    ),
  );
  await check(getDoc(doc(db, PRIZE)));
  await check(getDocs(collection(db, `fanClubs/${CLUB}/prizes`)));
  await check(getDoc(doc(db, SHARD)));
  await check(getDocs(collection(db, `fanClubStats/${CLUB}/fanClubShards`)));
  await check(getDoc(doc(db, POST)));
  await check(getDocs(query(collection(db, 'fanClubPosts'), where('clubId', '==', CLUB))));
  await check(getDoc(doc(db, QUEUE)));
  await check(getDocs(query(collection(db, 'fanClubReportQueue'), where('status', '==', 'open'))));
}

/** O vínculo de seguir e o marcador do crédito: o documento e o grupo dos seguidores. */
async function readsFollows(db: Db, outcome: 'succeeds' | 'fails'): Promise<void> {
  const check = outcome === 'succeeds' ? assertSucceeds : assertFails;
  await check(getDoc(doc(db, FOLLOW)));
  await check(getDocs(collection(db, `users/${FOLLOWER}/fanClubFollows`)));
  await check(getDoc(doc(db, CREDIT)));
  await check(
    getDocs(
      query(
        collectionGroup(db, 'fanClubFollows'),
        where('clubId', '==', CLUB),
        orderBy('followedAt', 'desc'),
      ),
    ),
  );
}

describe('a seção Fã-clubes', () => {
  it('o editor, o Leitor e o admin leem a candidatura, o fã-clube, os prêmios, os números, as publicações e a fila', async () => {
    for (const uid of ['admin', 'faClubes', 'leitorFaClubes']) {
      await readsSection(as(uid), 'succeeds');
    }
  });

  it('o fã (o próprio gestor também), outras seções e a desativada não leem', async () => {
    for (const uid of [GESTOR, FOLLOWER, 'fas', 'artistas', 'desativada']) {
      await readsSection(as(uid), 'fails');
    }
    await readsSection(env.unauthenticatedContext().firestore(), 'fails');
  });

  it('o privado da candidatura: só quem edita a seção (o Leitor não)', async () => {
    for (const uid of ['admin', 'faClubes']) {
      await assertSucceeds(getDoc(doc(as(uid), PRIVATE)));
    }
    for (const uid of ['leitorFaClubes', GESTOR, 'fas', 'desativada']) {
      await assertFails(getDoc(doc(as(uid), PRIVATE)));
      await assertFails(getDocs(collection(as(uid), 'fanClubApplicationPrivate')));
    }
  });

  it('as denúncias uma a uma ficam fechadas para todos, até a seção e o admin', async () => {
    for (const uid of ['admin', 'faClubes', 'leitorFaClubes', FOLLOWER]) {
      await assertFails(getDoc(doc(as(uid), REPORT)));
      await assertFails(getDocs(collection(as(uid), 'fanClubReports')));
    }
  });

  it('o documento de cima dos números não existe e fica fechado', async () => {
    await assertFails(getDoc(doc(as('admin'), `fanClubStats/${CLUB}`)));
  });
});

describe('o contato do fã (decisão 14)', () => {
  it('quem edita a seção Fã-clubes lê o documento pelo caminho, e o admin', async () => {
    for (const uid of ['admin', 'faClubes']) {
      await assertSucceeds(getDoc(doc(as(uid), CONTACT)));
    }
  });

  it('o Leitor, a seção Fãs, outras seções, a desativada e o próprio fã não leem; ninguém lista', async () => {
    for (const uid of ['leitorFaClubes', 'fas', 'artistas', 'desativada', GESTOR, FOLLOWER]) {
      await assertFails(getDoc(doc(as(uid), CONTACT)));
    }
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), CONTACT)));
    for (const uid of ['admin', 'faClubes', GESTOR]) {
      await assertFails(getDocs(collection(as(uid), `users/${GESTOR}/contact`)));
      await assertFails(getDocs(collectionGroup(as(uid), 'contact')));
    }
  });
});

describe('quem segue (decisão 29)', () => {
  it('só a seção Fãs lê o vínculo e o marcador, também pela consulta de grupo', async () => {
    for (const uid of ['admin', 'fas']) await readsFollows(as(uid), 'succeeds');
  });

  it('a seção Fã-clubes, o próprio fã e a desativada não leem', async () => {
    for (const uid of ['faClubes', 'leitorFaClubes', FOLLOWER, GESTOR, 'desativada']) {
      await readsFollows(as(uid), 'fails');
    }
  });
});

describe('ninguém grava pelo cliente', () => {
  it('nem o admin, nem a seção, nem o próprio fã', async () => {
    for (const uid of ['admin', 'faClubes', GESTOR, FOLLOWER]) {
      const db = as(uid);
      await assertFails(updateDoc(doc(db, APPLICATION), { status: 'pending' }));
      await assertFails(setDoc(doc(db, `fanClubApplications/${uid}`), { status: 'pending' }));
      await assertFails(deleteDoc(doc(db, PRIVATE)));
      await assertFails(updateDoc(doc(db, FAN_CLUB), { status: 'paused' }));
      await assertFails(setDoc(doc(db, 'fanClubs/outro'), { status: 'active' }));
      await assertFails(setDoc(doc(db, PRIZE), { points: 1 }));
      await assertFails(setDoc(doc(db, SHARD), { joins: 99 }));
      await assertFails(updateDoc(doc(db, POST), { status: 'published' }));
      await assertFails(setDoc(doc(db, REPORT), { reason: 'spam' }));
      await assertFails(updateDoc(doc(db, QUEUE), { status: 'resolved' }));
      await assertFails(deleteDoc(doc(db, FOLLOW)));
      await assertFails(setDoc(doc(db, `users/${uid}/fanClubFollows/${CLUB}`), { clubId: CLUB }));
      await assertFails(setDoc(doc(db, CREDIT), { via: 'follow' }));
      await assertFails(setDoc(doc(db, CONTACT), { whatsapp: '+5575988887777' }));
      await assertFails(deleteDoc(doc(db, CONTACT)));
    }
  });
});
