import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regras do Storage (fotos das centrais em artists/{id}/) contra os emuladores
 * de Storage e Firestore: o storage.rules lê staff/{uid} e artists/{id} no
 * Firestore do mesmo projeto. Rode com `npm run test:rules`. O clearStorage() da biblioteca só
 * apaga a raiz do bucket, então cada teste sobe num caminho próprio.
 */
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'imagine-up-app',
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
    storage: { rules: readFileSync(resolve(__dirname, '../storage.rules'), 'utf8') },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedStaff();
  await seedArtist(ARTIST_ID);
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

const LINKED_AT = 1_800_000_000;
// Central criada antes de cada teste: a foto só sobe para uma central que existe.
const ARTIST_ID = 'triobembahia';
const MB = 1024 * 1024;

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
  editorSemSecao: { role: 'editor', status: 'active', sections: ['fans', 'missions'] },
  desativada: { role: 'editor', status: 'disabled', sections: ['artists'] },
  adminDesativado: { role: 'admin', status: 'disabled' },
  pendente: { role: 'admin', status: 'pending' },
  ligada: { role: 'editor', status: 'active', sections: ['artists'], authValidAfter: LINKED_AT },
};

/** Membros gravados como o servidor grava. */
async function seedStaff(): Promise<void> {
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
        inviteId: `convite-${uid}`,
        invitedBy: null,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        updatedBy: null,
        ...(member.authValidAfter === undefined ? {} : { authValidAfter: member.authValidAfter }),
      });
    }
  });
}

/** Central gravada como o createArtist grava (o que importa às regras é existir). */
async function seedArtist(artistId: string): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `artists/${artistId}`), {
      handle: artistId,
      name: `Central ${artistId}`,
      status: 'draft',
      photo: null,
      thumb: null,
      order: 0,
      fanCount: 0,
      publishedAt: null,
    });
  });
}

/** Storage de um contexto de teste (API compat da biblioteca). */
type Storage = ReturnType<RulesTestContext['storage']>;

const as = (uid: string, authTime?: number) =>
  env
    .authenticatedContext(uid, authTime === undefined ? undefined : { auth_time: authTime })
    .storage();
const anonymous = () => env.unauthenticatedContext().storage();

// Caminho único por envio: o clearStorage não limpa as subpastas.
let counter = 0;
const newPath = (artistId = ARTIST_ID, ext = 'webp') =>
  `artists/${artistId}/photo-${Date.now()}-${++counter}-1200.${ext}`;

/** Bytes de mentira: as regras olham o tamanho e o tipo declarado, não o conteúdo. */
const bytes = (size: number) => new Uint8Array(size).fill(7);

/** Envio como o painel faz (tipo, cache e largura/altura no metadado). */
function upload(
  storage: Storage,
  path: string,
  options: { size?: number; contentType?: string } = {},
): Promise<unknown> {
  const task = storage.ref(path).put(bytes(options.size ?? 2048), {
    contentType: options.contentType ?? 'image/webp',
    cacheControl: 'public, max-age=31536000, immutable',
    customMetadata: { width: '1200', height: '1600' },
  });
  return task.then((snapshot) => snapshot);
}

/** Uma foto que já está no bucket, subida pela editora. */
async function existingPhoto(): Promise<string> {
  const path = newPath();
  await assertSucceeds(upload(as('editora'), path));
  return path;
}

describe('fotos das centrais: quem sobe', () => {
  it('admin e editora com a seção artists sobem uma foto webp pequena', async () => {
    for (const uid of ['admin', 'editora']) {
      await assertSucceeds(upload(as(uid), newPath()));
    }
  });

  it('jpeg e png também passam', async () => {
    await assertSucceeds(
      upload(as('editora'), newPath(ARTIST_ID, 'jpg'), { contentType: 'image/jpeg' }),
    );
    await assertSucceeds(
      upload(as('editora'), newPath(ARTIST_ID, 'png'), { contentType: 'image/png' }),
    );
  });

  it('leitor com a seção, editor sem a seção, desativados e pendente não sobem', async () => {
    for (const uid of ['leitor', 'editorSemSecao', 'desativada', 'adminDesativado', 'pendente']) {
      await assertFails(upload(as(uid), newPath()));
    }
  });

  it('fã, custom claim de admin sem staff e sem login não sobem', async () => {
    await assertFails(upload(as('fa'), newPath()));
    const claims = env.authenticatedContext('fa', { staff: true, role: 'admin' }).storage();
    await assertFails(upload(claims, newPath()));
    await assertFails(upload(anonymous(), newPath()));
  });

  it('conta ligada: sessão de antes do login que ligou não sobe; a do login em diante sobe', async () => {
    await assertFails(upload(as('ligada', LINKED_AT - 1), newPath()));
    await assertSucceeds(upload(as('ligada', LINKED_AT), newPath()));
  });

  it('desativar corta o envio no pedido seguinte', async () => {
    await assertSucceeds(upload(as('editora'), newPath()));
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'staff/editora'), { status: 'disabled' });
    });
    await assertFails(upload(as('editora'), newPath()));
  });
});

describe('fotos das centrais: o que sobe', () => {
  it('tipo que não é webp, jpeg ou png é recusado', async () => {
    for (const contentType of [
      'image/gif',
      'image/heic',
      'image/svg+xml',
      'text/plain',
      'application/octet-stream',
    ]) {
      await assertFails(upload(as('admin'), newPath(ARTIST_ID, 'bin'), { contentType }));
    }
  });

  it('até 5 MB passa; acima, não', async () => {
    await assertSucceeds(upload(as('admin'), newPath(), { size: 5 * MB }));
    await assertFails(upload(as('admin'), newPath(), { size: 5 * MB + 1 }));
  });

  it('arquivo vazio é recusado', async () => {
    await assertFails(upload(as('admin'), newPath(), { size: 0 }));
  });

  it('só para uma central que existe: @ sem central, ou central apagada, não recebe foto', async () => {
    for (const uid of ['admin', 'editora']) {
      await assertFails(upload(as(uid), newPath('semcentral')));
    }
    await seedArtist('semcentral');
    await assertSucceeds(upload(as('editora'), newPath('semcentral')));
    // A admin apaga o rascunho enquanto a editora ainda sobe fotos para ele.
    await env.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), 'artists/semcentral'));
    });
    await assertFails(upload(as('editora'), newPath('semcentral')));
  });

  it('id que o Firestore reserva (__.*__) nunca recebe foto, mesmo no formato do @', async () => {
    for (const artistId of ['____', '__trio__']) {
      await assertFails(upload(as('admin'), newPath(artistId)));
    }
  });

  it('só dentro de artists/{@}/, com o @ no formato, e sem subpastas', async () => {
    await assertFails(upload(as('admin'), `artists/Trio Bem/photo-${++counter}.webp`));
    await assertFails(upload(as('admin'), `artists/triobembahia/sub/photo-${++counter}.webp`));
    await assertFails(upload(as('admin'), `users/admin/photo-${++counter}.webp`));
    await assertFails(upload(as('admin'), `photo-${++counter}.webp`));
  });
});

describe('fotos das centrais: ler, listar, trocar e apagar', () => {
  it('qualquer um baixa uma foto pelo caminho exato, até sem login', async () => {
    const path = await existingPhoto();
    for (const storage of [anonymous(), as('fa'), as('admin')]) {
      const metadata = await assertSucceeds(storage.ref(path).getMetadata());
      expect(metadata.contentType).toBe('image/webp');
      const url = await assertSucceeds(storage.ref(path).getDownloadURL());
      expect(url).toContain(encodeURIComponent(path));
    }
  });

  it('ninguém lista a pasta de uma central, nem a admin', async () => {
    await existingPhoto();
    for (const storage of [anonymous(), as('fa'), as('editora'), as('admin')]) {
      await assertFails(storage.ref('artists/triobembahia').listAll());
      await assertFails(storage.ref('artists').list({ maxResults: 10 }));
    }
  });

  it('ninguém apaga nem troca metadados pelo cliente, nem a admin (o servidor apaga)', async () => {
    const path = await existingPhoto();
    for (const storage of [as('fa'), as('editora'), as('admin')]) {
      await assertFails(storage.ref(path).delete());
      await assertFails(storage.ref(path).updateMetadata({ contentType: 'image/png' }));
    }
    // Subir de novo no mesmo caminho troca o arquivo por cima: também não.
    await assertFails(upload(as('admin'), path));
  });

  it('fora de artists/, nada se lê', async () => {
    await assertFails(anonymous().ref('users/fa/avatar.webp').getMetadata());
    await assertFails(as('admin').ref('outro/arquivo.webp').getMetadata());
  });
});
