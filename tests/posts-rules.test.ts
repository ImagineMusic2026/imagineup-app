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
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regras do mural do bloco 6 (docs/arquitetura-api.md, 21.11) contra o
 * emulador. Rode com `npm run test:rules`. Posts, comentários, curtidas,
 * presenças e as contagens são só do servidor: o fã recebe tudo pela API, nem
 * os posts no ar lê direto. A equipe lê pela seção: posts com artists,
 * moderation ou fans; comentários com artists ou moderation; curtidas e
 * presenças com fans; os shards das contagens, ninguém.
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
  artistas: { role: 'editor', status: 'active', sections: ['artists'] },
  leitorArtistas: { role: 'viewer', status: 'active', sections: ['artists'] },
  moderacao: { role: 'editor', status: 'active', sections: ['moderation'] },
  fas: { role: 'viewer', status: 'active', sections: ['fans'] },
  semSecao: { role: 'editor', status: 'active', sections: ['missions', 'overview'] },
  desativada: { role: 'editor', status: 'disabled', sections: ['artists', 'moderation', 'fans'] },
  pendente: { role: 'admin', status: 'pending' },
  ligada: {
    role: 'editor',
    status: 'active',
    sections: ['artists', 'fans'],
    authValidAfter: LINKED_AT,
  },
};

const POST = 'posts/p-clipe';
const DRAFT = 'posts/p-rascunho';
const COMMENT = 'posts/p-clipe/postComments/seed-c-clipe-bia';
const SHARD = 'postStats/p-clipe/countShards/3';
const LIKE = 'users/uid-camila/postLikes/p-clipe';
const RSVP = 'users/uid-camila/eventRsvps/sao-joao-irara';

/** Equipe, perfis e os documentos do mural, como o servidor grava. */
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
    await setDoc(doc(db, POST), {
      artistId: 'nettobrito',
      kind: 'video',
      text: 'Saiu o clipe',
      status: 'published',
      publishedAt: at,
      likeCount: 3,
      commentCount: 4,
    });
    await setDoc(doc(db, DRAFT), { artistId: 'nettobrito', kind: 'text', status: 'draft' });
    await setDoc(doc(db, COMMENT), {
      postId: 'p-clipe',
      artistId: 'nettobrito',
      authorUid: 'uid-bia',
      authorName: 'Bia Santos',
      text: 'Irará em peso!',
      status: 'visible',
      createdAt: at,
    });
    await setDoc(doc(db, SHARD), { likes: 3, comments: 4, updatedAt: at });
    await setDoc(doc(db, LIKE), {
      uid: 'uid-camila',
      postId: 'p-clipe',
      artistId: 'nettobrito',
      liked: true,
      firstLikedAt: at,
      updatedAt: at,
    });
    await setDoc(doc(db, RSVP), {
      uid: 'uid-camila',
      eventId: 'sao-joao-irara',
      going: true,
      artistIds: ['nettobrito'],
      firstGoingAt: at,
      updatedAt: at,
    });
    // Coleções de raiz com os nomes das subcoleções, que nenhum código cria (21.11).
    for (const name of ['postLikes', 'eventRsvps', 'postComments']) {
      await setDoc(doc(db, `${name}/raiz`), { artistId: 'nettobrito' });
    }
  });
}

type Db = ReturnType<RulesTestContext['firestore']>;

const as = (uid: string, authTime?: number) =>
  env
    .authenticatedContext(uid, authTime === undefined ? undefined : { auth_time: authTime })
    .firestore();
const anonymous = () => env.unauthenticatedContext().firestore();

async function readsPosts(db: Db, outcome: 'succeeds' | 'fails'): Promise<void> {
  const check = outcome === 'succeeds' ? assertSucceeds : assertFails;
  await check(getDoc(doc(db, POST)));
  await check(getDoc(doc(db, DRAFT)));
  await check(getDocs(query(collection(db, 'posts'), where('artistId', '==', 'nettobrito'))));
}

async function readsComments(db: Db, outcome: 'succeeds' | 'fails'): Promise<void> {
  const check = outcome === 'succeeds' ? assertSucceeds : assertFails;
  await check(getDoc(doc(db, COMMENT)));
  await check(getDocs(collection(db, 'posts/p-clipe/postComments')));
  await check(
    getDocs(query(collectionGroup(db, 'postComments'), where('authorUid', '==', 'uid-bia'))),
  );
}

async function readsLikesAndRsvps(db: Db, outcome: 'succeeds' | 'fails'): Promise<void> {
  const check = outcome === 'succeeds' ? assertSucceeds : assertFails;
  await check(getDoc(doc(db, LIKE)));
  await check(getDocs(collection(db, 'users/uid-camila/postLikes')));
  await check(getDoc(doc(db, RSVP)));
  await check(
    getDocs(
      query(
        collectionGroup(db, 'eventRsvps'),
        where('eventId', '==', 'sao-joao-irara'),
        where('going', '==', true),
      ),
    ),
  );
  await check(getDocs(query(collectionGroup(db, 'postLikes'), where('postId', '==', 'p-clipe'))));
}

/** Nada disso se grava pelo cliente: só o servidor. */
async function writesNothing(db: Db): Promise<void> {
  await assertFails(setDoc(doc(db, 'posts/p-novo'), { artistId: 'nettobrito', kind: 'text' }));
  await assertFails(updateDoc(doc(db, POST), { likeCount: 999 }));
  await assertFails(deleteDoc(doc(db, DRAFT)));
  await assertFails(setDoc(doc(db, 'posts/p-clipe/postComments/c-novo'), { text: 'oi' }));
  await assertFails(updateDoc(doc(db, COMMENT), { status: 'hidden' }));
  await assertFails(deleteDoc(doc(db, COMMENT)));
  await assertFails(setDoc(doc(db, SHARD), { likes: 100 }));
  await assertFails(setDoc(doc(db, 'users/uid-camila/postLikes/p-g1'), { liked: true }));
  await assertFails(updateDoc(doc(db, LIKE), { liked: false }));
  await assertFails(setDoc(doc(db, 'users/uid-camila/eventRsvps/outro'), { going: true }));
  await assertFails(deleteDoc(doc(db, RSVP)));
}

describe('posts e comentários', () => {
  it('o fã não lê nem o post no ar (vem pela API) e não grava nada', async () => {
    await readsPosts(as('uid-camila'), 'fails');
    await readsComments(as('uid-camila'), 'fails');
    await readsPosts(anonymous(), 'fails');
    await writesNothing(as('uid-camila'));
  });

  it('a equipe com artists lê posts e comentários (também pelo grupo)', async () => {
    for (const uid of ['admin', 'artistas', 'leitorArtistas']) {
      await readsPosts(as(uid), 'succeeds');
      await readsComments(as(uid), 'succeeds');
    }
    await readsPosts(as('ligada', LINKED_AT), 'succeeds');
  });

  it('a Moderação lê posts e comentários; a seção Fãs lê posts e não lê comentários', async () => {
    await readsPosts(as('moderacao'), 'succeeds');
    await readsComments(as('moderacao'), 'succeeds');
    await readsPosts(as('fas'), 'succeeds');
    await readsComments(as('fas'), 'fails');
  });

  it('sem nenhuma dessas seções, desativada, pendente ou com sessão de antes do authValidAfter não lê', async () => {
    for (const uid of ['semSecao', 'desativada', 'pendente']) {
      await readsPosts(as(uid), 'fails');
      await readsComments(as(uid), 'fails');
    }
    await readsPosts(as('ligada', LINKED_AT - 1), 'fails');
  });

  it('ninguém grava, nem admin', async () => {
    for (const uid of ['admin', 'artistas', 'moderacao', 'fas']) await writesNothing(as(uid));
  });
});

describe('curtidas e presenças do fã', () => {
  it('o próprio fã não lê (vem pela API); a equipe com fans lê, também pelos grupos', async () => {
    await readsLikesAndRsvps(as('uid-camila'), 'fails');
    for (const uid of ['admin', 'fas']) await readsLikesAndRsvps(as(uid), 'succeeds');
    await readsLikesAndRsvps(as('ligada', LINKED_AT), 'succeeds');
    for (const uid of ['artistas', 'moderacao', 'desativada']) {
      await readsLikesAndRsvps(as(uid), 'fails');
    }
  });
});

describe('shards das contagens (postStats)', () => {
  it('ninguém lê pelo cliente: nem a equipe com artists, nem admin, nem o fã', async () => {
    for (const uid of ['admin', 'artistas', 'moderacao', 'uid-camila']) {
      const db = as(uid);
      await assertFails(getDoc(doc(db, SHARD)));
      await assertFails(getDocs(collection(db, 'postStats/p-clipe/countShards')));
      await assertFails(getDoc(doc(db, 'postStats/p-clipe')));
      await assertFails(getDocs(collectionGroup(db, 'countShards')));
    }
  });
});

describe('as regras de grupo do mural', () => {
  // As regras de grupo alcançam qualquer coleção com o mesmo nome, em qualquer
  // profundidade, e regra não é filtro. Por isso nenhuma outra coleção pode se
  // chamar postLikes, eventRsvps ou postComments; este teste deixa o alcance escrito.
  it('coleções de raiz com esses nomes ficam legíveis para a seção do grupo, e só para ela', async () => {
    await assertSucceeds(getDoc(doc(as('fas'), 'postLikes/raiz')));
    await assertSucceeds(getDoc(doc(as('fas'), 'eventRsvps/raiz')));
    await assertSucceeds(getDoc(doc(as('moderacao'), 'postComments/raiz')));
    await assertFails(getDoc(doc(as('uid-camila'), 'postLikes/raiz')));
    await assertFails(getDoc(doc(as('artistas'), 'eventRsvps/raiz')));
    await assertFails(getDoc(doc(as('fas'), 'postComments/raiz')));
  });
});
