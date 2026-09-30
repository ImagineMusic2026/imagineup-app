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
 * Regras das centrais dos artistas (artists/ e artistPrivate/) contra o
 * emulador. Rode com `npm run test:rules`. Tudo é gravado pelo servidor (as
 * callables do painel); o fã logado lê só as centrais publicadas, e a equipe
 * com a seção artists lê todas e a parte só da equipe (artistPrivate/).
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
  editora: { role: 'editor', status: 'active', sections: ['artists'] },
  leitor: { role: 'viewer', status: 'active', sections: ['artists'] },
  leitorSemSecao: { role: 'viewer', status: 'active', sections: ['fans', 'audit'] },
  editorSemSecao: { role: 'editor', status: 'active', sections: ['missions'] },
  desativada: { role: 'editor', status: 'disabled', sections: ['artists'] },
  pendente: { role: 'admin', status: 'pending' },
  ligada: { role: 'editor', status: 'active', sections: ['artists'], authValidAfter: LINKED_AT },
};

// Campos de artists/{id} (o que o app mostra), como o createArtist grava.
const PUBLIC_FIELDS = [
  'bio',
  'city',
  'createdAt',
  'fanCount',
  'genre',
  'handle',
  'name',
  'order',
  'photo',
  'publishedAt',
  'shortName',
  'status',
  'thumb',
  'updatedAt',
  'verified',
];

// Só da equipe: ficam em artistPrivate/{id}, nunca no doc que o fã lê.
const STAFF_ONLY_FIELDS = [
  'email',
  'phone',
  'managerUid',
  'managerName',
  'imageRightsConfirmed',
  'createdBy',
  'updatedBy',
];

function artistDoc(handle: string, status: 'draft' | 'published' | 'unpublished', order: number) {
  const now = Timestamp.now();
  const image = (width: number) => ({
    url: `https://firebasestorage.googleapis.com/v0/b/b/o/artists%2F${handle}%2F${width}.webp?alt=media&token=t`,
    path: `artists/${handle}/${width}.webp`,
    width,
    height: (width / 3) * 4,
  });
  return {
    handle,
    name: handle,
    shortName: null,
    genre: 'Piseiro',
    city: 'Salvador, BA',
    bio: null,
    verified: status === 'published',
    photo: status === 'draft' ? null : image(1200),
    thumb: status === 'draft' ? null : image(480),
    order,
    status,
    fanCount: 0,
    publishedAt: status === 'draft' ? null : now,
    createdAt: now,
    updatedAt: now,
  };
}

/** artistPrivate/{id}, como o createArtist grava. */
function privateDoc(handle: string, imageRightsConfirmed: boolean) {
  return {
    email: `${handle}@contato.com`,
    phone: '+5571998765432',
    managerUid: 'editora',
    managerName: 'editora',
    imageRightsConfirmed,
    createdBy: 'admin',
    updatedBy: 'admin',
    updatedAt: Timestamp.now(),
  };
}

/** Equipe, três centrais (no ar, rascunho e fora do ar) e a parte da equipe, como o servidor grava. */
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
    await setDoc(doc(db, 'artists/triobembahia'), artistDoc('triobembahia', 'published', 0));
    await setDoc(doc(db, 'artists/juninho_m'), artistDoc('juninho_m', 'draft', 1));
    await setDoc(doc(db, 'artists/nenho'), artistDoc('nenho', 'unpublished', 2));
    for (const handle of ['triobembahia', 'juninho_m', 'nenho']) {
      await setDoc(doc(db, `artistPrivate/${handle}`), privateDoc(handle, handle !== 'juninho_m'));
      await setDoc(doc(db, `usernames/${handle}`), {
        artistId: handle,
        createdAt: Timestamp.now(),
      });
    }
  });
}

/** Firestore de um contexto de teste (logado ou não). */
type Db = ReturnType<RulesTestContext['firestore']>;

const as = (uid: string, authTime?: number) =>
  env
    .authenticatedContext(uid, authTime === undefined ? undefined : { auth_time: authTime })
    .firestore();
const anonymous = () => env.unauthenticatedContext().firestore();

const listAll = (db: Db) => getDocs(collection(db, 'artists'));
const listPublished = (db: Db) =>
  getDocs(query(collection(db, 'artists'), where('status', '==', 'published')));
const listDrafts = (db: Db) =>
  getDocs(query(collection(db, 'artists'), where('status', '==', 'draft')));
const listPrivate = (db: Db) => getDocs(collection(db, 'artistPrivate'));

/** Nada que não está publicado passa para esta pessoa, nem a parte da equipe. */
async function readsNothingUnpublished(db: Db): Promise<void> {
  await assertFails(getDoc(doc(db, 'artists/juninho_m')));
  await assertFails(getDoc(doc(db, 'artists/nenho')));
  await assertFails(listAll(db));
  await assertFails(listDrafts(db));
  await assertFails(getDoc(doc(db, 'artistPrivate/triobembahia')));
  await assertFails(getDoc(doc(db, 'artistPrivate/juninho_m')));
  await assertFails(listPrivate(db));
}

/** Lê tudo das centrais, inclusive rascunhos e a parte da equipe. */
async function readsEverything(db: Db): Promise<void> {
  await assertSucceeds(getDoc(doc(db, 'artists/juninho_m')));
  await assertSucceeds(getDoc(doc(db, 'artists/nenho')));
  const all = await assertSucceeds(listAll(db));
  expect(all.size).toBe(3);
  await assertSucceeds(listDrafts(db));
  const internal = await assertSucceeds(getDoc(doc(db, 'artistPrivate/triobembahia')));
  expect(internal.data()).toMatchObject({
    managerUid: 'editora',
    managerName: 'editora',
    imageRightsConfirmed: true,
    createdBy: 'admin',
    updatedBy: 'admin',
  });
  const everyPrivate = await assertSucceeds(listPrivate(db));
  expect(everyPrivate.size).toBe(3);
}

describe('centrais: quem lê', () => {
  beforeEach(seed);

  it('fã logado lê a central publicada e a lista filtrada por status published', async () => {
    const db = as('fa');
    const central = await assertSucceeds(getDoc(doc(db, 'artists/triobembahia')));
    expect(central.get('status')).toBe('published');
    const published = await assertSucceeds(listPublished(db));
    expect(published.docs.map((snap) => snap.id)).toEqual(['triobembahia']);
  });

  it('o doc que o fã lê não tem nada da equipe: contato, gestor, autorização e autoria', async () => {
    const db = as('fa');
    const central = await assertSucceeds(getDoc(doc(db, 'artists/triobembahia')));
    const listed = (await assertSucceeds(listPublished(db))).docs.map((snap) => snap.data());
    expect(listed).toHaveLength(1);
    for (const data of [central.data(), ...listed]) {
      expect(Object.keys(data ?? {}).sort()).toEqual(PUBLIC_FIELDS);
      for (const field of STAFF_ONLY_FIELDS) expect(data).not.toHaveProperty(field);
    }
  });

  it('fã não lê rascunho, central fora do ar nem artistPrivate, e a lista sem o filtro é negada', async () => {
    await readsNothingUnpublished(as('fa'));
    // Nem o artistPrivate da central que está no ar.
    await assertFails(getDoc(doc(as('fa'), 'artistPrivate/triobembahia')));
  });

  it('fã não lê a reserva do @ da central', async () => {
    await assertFails(getDoc(doc(as('fa'), 'usernames/triobembahia')));
  });

  it('sem login, nem a central publicada', async () => {
    const db = anonymous();
    await assertFails(getDoc(doc(db, 'artists/triobembahia')));
    await assertFails(listPublished(db));
    await readsNothingUnpublished(db);
  });

  it('admin, editora e leitor com a seção artists leem tudo, com o artistPrivate', async () => {
    for (const uid of ['admin', 'editora', 'leitor']) {
      await readsEverything(as(uid));
    }
  });

  it('equipe sem a seção artists só lê o publicado, como fã', async () => {
    for (const uid of ['leitorSemSecao', 'editorSemSecao']) {
      const db = as(uid);
      await assertSucceeds(getDoc(doc(db, 'artists/triobembahia')));
      await assertSucceeds(listPublished(db));
      await readsNothingUnpublished(db);
    }
  });

  it('desativada ou pendente não lê nada que não está publicado', async () => {
    await readsNothingUnpublished(as('desativada'));
    await readsNothingUnpublished(as('pendente'));
  });

  it('custom claim de admin não vale nada sem o doc em staff', async () => {
    await readsNothingUnpublished(
      env.authenticatedContext('fa', { staff: true, role: 'admin' }).firestore(),
    );
  });

  it('conta ligada: sessão de antes do login que ligou não lê; a do login em diante lê', async () => {
    await readsNothingUnpublished(as('ligada', LINKED_AT - 1));
    await readsEverything(as('ligada', LINKED_AT));
  });

  it('desativar corta a leitura dos rascunhos no pedido seguinte', async () => {
    const db = as('editora');
    await assertSucceeds(getDoc(doc(db, 'artists/juninho_m')));
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'staff/editora'), { status: 'disabled' });
    });
    await readsNothingUnpublished(db);
  });
});

describe('centrais: ninguém grava pelo cliente', () => {
  beforeEach(seed);

  it('nem admin nem editora com a seção gravam centrais, artistPrivate ou reservas de @', async () => {
    for (const uid of ['admin', 'editora']) {
      const db = as(uid);
      await assertFails(setDoc(doc(db, 'artists/nova'), artistDoc('nova', 'draft', 3)));
      await assertFails(updateDoc(doc(db, 'artists/juninho_m'), { status: 'published' }));
      await assertFails(updateDoc(doc(db, 'artists/triobembahia'), { order: 9 }));
      await assertFails(deleteDoc(doc(db, 'artists/juninho_m')));
      await assertFails(setDoc(doc(db, 'artistPrivate/nova'), privateDoc('nova', false)));
      await assertFails(updateDoc(doc(db, 'artistPrivate/juninho_m'), { email: 'x@y.io' }));
      await assertFails(
        updateDoc(doc(db, 'artistPrivate/juninho_m'), { imageRightsConfirmed: true }),
      );
      await assertFails(deleteDoc(doc(db, 'artistPrivate/juninho_m')));
      await assertFails(setDoc(doc(db, 'usernames/nova'), { artistId: 'nova' }));
      await assertFails(deleteDoc(doc(db, 'usernames/triobembahia')));
    }
  });

  it('fã não publica, não muda o contador de fãs, não cria central nem mexe no artistPrivate', async () => {
    const db = as('fa');
    await assertFails(updateDoc(doc(db, 'artistPrivate/triobembahia'), { managerUid: 'fa' }));
    await assertFails(updateDoc(doc(db, 'artists/juninho_m'), { status: 'published' }));
    await assertFails(updateDoc(doc(db, 'artists/triobembahia'), { fanCount: 1000 }));
    await assertFails(setDoc(doc(db, 'artists/fa'), artistDoc('fa', 'published', 0)));
    await assertFails(
      setDoc(doc(anonymous(), 'artists/anonimo'), artistDoc('anonimo', 'published', 0)),
    );
  });

  it('subcoleções das centrais também são do servidor', async () => {
    await assertFails(getDoc(doc(as('admin'), 'artists/triobembahia/posts/1')));
    await assertFails(setDoc(doc(as('admin'), 'artists/triobembahia/posts/1'), { texto: 'x' }));
  });
});
