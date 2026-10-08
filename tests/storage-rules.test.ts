import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, deleteField, doc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
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
  // Bloco 10: quem edita e quem só vê Recompensas e resgates.
  editoraLoja: { role: 'editor', status: 'active', sections: ['rewards'] },
  leitoraLoja: { role: 'viewer', status: 'active', sections: ['rewards'] },
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

// --- Mídia dos posts e foto dos shows (bloco 6, 21.11) --------------------------------

/** Post e show gravados como as callables gravam (o que importa às regras é o tipo e existir). */
async function seedContent(): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const kind of ['photo', 'video', 'text', 'event']) {
      await setDoc(doc(db, `posts/p-${kind}`), {
        artistId: ARTIST_ID,
        kind,
        status: 'draft',
        media: null,
      });
    }
    await setDoc(doc(db, 'events/show-1'), {
      title: 'Show',
      artistIds: [ARTIST_ID],
      status: 'draft',
      photo: null,
    });
  });
}

const postPath = (postId: string, ext = 'webp') =>
  `posts/${postId}/arquivo-${Date.now()}-${++counter}.${ext}`;
const eventPath = (eventId = 'show-1') => `events/${eventId}/photo-${Date.now()}-${++counter}.webp`;

describe('mídia dos posts (posts/{id}/)', () => {
  beforeEach(seedContent);

  it('quem edita artists sobe imagem num post de foto; leitor, outra seção e fã não', async () => {
    for (const uid of ['admin', 'editora']) {
      await assertSucceeds(upload(as(uid), postPath('p-photo')));
    }
    for (const uid of ['leitor', 'editorSemSecao', 'desativada', 'fa']) {
      await assertFails(upload(as(uid), postPath('p-photo')));
    }
    await assertFails(upload(anonymous(), postPath('p-photo')));
  });

  it('o tipo do post decide: mp4 só no vídeo; imagem na foto e no vídeo; nada no texto e no show', async () => {
    const mp4 = { contentType: 'video/mp4' };
    await assertSucceeds(upload(as('editora'), postPath('p-video'), {}));
    await assertSucceeds(
      upload(as('editora'), postPath('p-video', 'mp4'), { ...mp4, size: 50 * MB }),
    );
    await assertFails(
      upload(as('editora'), postPath('p-video', 'mp4'), { ...mp4, size: 50 * MB + 1 }),
    );
    await assertFails(upload(as('editora'), postPath('p-photo', 'mp4'), mp4));
    for (const postId of ['p-text', 'p-event']) {
      await assertFails(upload(as('editora'), postPath(postId)));
      await assertFails(upload(as('editora'), postPath(postId, 'mp4'), mp4));
    }
    await assertFails(upload(as('editora'), postPath('p-photo'), { size: 5 * MB + 1 }));
    await assertFails(upload(as('editora'), postPath('p-photo'), { contentType: 'image/gif' }));
  });

  it('só para um post que existe, com o id no formato, sem subpastas', async () => {
    await assertFails(upload(as('admin'), postPath('p-naoexiste')));
    await assertFails(upload(as('admin'), postPath('__x__')));
    await assertFails(upload(as('admin'), `posts/p-photo/sub/arquivo-${++counter}.webp`));
  });

  it('qualquer um baixa pelo caminho exato; ninguém lista, troca nem apaga', async () => {
    const path = postPath('p-photo');
    await assertSucceeds(upload(as('editora'), path));
    await assertSucceeds(anonymous().ref(path).getMetadata());
    for (const storage of [as('fa'), as('admin')]) {
      await assertFails(storage.ref('posts/p-photo').listAll());
      await assertFails(storage.ref(path).delete());
      await assertFails(storage.ref(path).updateMetadata({ contentType: 'image/png' }));
    }
    await assertFails(upload(as('admin'), path));
  });
});

describe('foto dos shows (events/{id}/)', () => {
  beforeEach(seedContent);

  it('imagem até 5 MB de quem edita artists, só para um show que existe', async () => {
    await assertSucceeds(upload(as('editora'), eventPath()));
    await assertFails(upload(as('leitor'), eventPath()));
    await assertFails(upload(as('fa'), eventPath()));
    await assertFails(upload(as('editora'), eventPath(), { size: 5 * MB + 1 }));
    await assertFails(upload(as('editora'), eventPath(), { contentType: 'video/mp4' }));
    await assertFails(upload(as('editora'), eventPath('show-naoexiste')));
  });

  it('ninguém lista nem apaga', async () => {
    const path = eventPath();
    await assertSucceeds(upload(as('editora'), path));
    await assertFails(as('admin').ref('events/show-1').listAll());
    await assertFails(as('admin').ref(path).delete());
  });
});

describe('foto do fã (fans/{uid}/)', () => {
  // A fã com perfil (users/camila, como o servidor cria) e o fã sem perfil.
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/camila'), {
        displayName: 'Camila Ribeiro',
        username: 'camilarib',
        city: null,
        photoURL: null,
        createdAt: Timestamp.now(),
      });
      await setDoc(doc(context.firestore(), 'users/alan'), {
        displayName: 'Alan',
        username: 'alan',
        city: null,
        photoURL: null,
        createdAt: Timestamp.now(),
      });
    });
  });

  // Nome no formato do app (photo-<createIdempotencyKey()>.jpg), novo a cada envio.
  const photoPath = (uid = 'camila') =>
    `fans/${uid}/photo-mg5k2x1a-${(++counter).toString(36).padStart(8, '0')}.jpg`;
  const jpeg = { contentType: 'image/jpeg' };

  /**
   * A vaga de envio que o POST /me/photo/upload grava (proteção contra abuso,
   * 27.4): o nome do arquivo e o prazo. Sem ela, nenhum envio do fã passa.
   */
  async function reserveSlot(uid: string, path: string, expiresInMs = 10 * 60_000) {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `users/${uid}/uploads/photo`), {
        fileName: path.split('/').at(-1),
        expiresAt: Timestamp.fromMillis(Date.now() + expiresInMs),
        createdAt: Timestamp.now(),
      });
    });
  }

  /** Um nome novo na pasta do fã, já com a vaga aberta para ele. */
  async function reservedPath(uid = 'camila'): Promise<string> {
    const path = photoPath(uid);
    await reserveSlot(uid, path);
    return path;
  }

  it('a fã com perfil e a vaga aberta sobe um JPEG pequeno com o nome no formato', async () => {
    await assertSucceeds(upload(as('camila'), await reservedPath(), jpeg));
  });

  it('sem vaga, com a vaga de outro arquivo ou com a vaga vencida, não sobe (27.4)', async () => {
    await assertFails(upload(as('camila'), photoPath(), jpeg));
    const other = await reservedPath();
    await assertFails(upload(as('camila'), photoPath(), jpeg));
    // A vaga nova troca a de antes: o envio que ficou para trás não passa mais.
    await reservedPath();
    await assertFails(upload(as('camila'), other, jpeg));
    const expired = photoPath();
    await reserveSlot('camila', expired, -1_000);
    await assertFails(upload(as('camila'), expired, jpeg));
  });

  it('a vaga de um fã não abre a pasta de outro', async () => {
    const path = photoPath('camila');
    await reserveSlot('alan', path);
    await assertFails(upload(as('camila'), path, jpeg));
  });

  it('outro fã, sem login, a equipe e a conta só da equipe não sobem na pasta dela', async () => {
    await assertFails(upload(as('alan'), await reservedPath(), jpeg));
    await assertFails(upload(anonymous(), await reservedPath(), jpeg));
    await assertFails(upload(as('admin'), await reservedPath(), jpeg));
    // A conta só da equipe (staff/editora, sem users/editora) na própria pasta.
    await assertFails(upload(as('editora'), await reservedPath('editora'), jpeg));
  });

  it('sem users/{uid} (conta excluída, token ainda válido), não sobe', async () => {
    const path = await reservedPath();
    await env.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), 'users/camila'));
    });
    await assertFails(upload(as('camila'), path, jpeg));
  });

  it('o fã suspenso não sobe foto, e volta a subir quando a suspensão sai (bloco 11)', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'users/camila'), {
        suspendedAt: Timestamp.now(),
        suspensionReason: 'offensive',
      });
    });
    await assertFails(upload(as('camila'), await reservedPath(), jpeg));
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'users/camila'), {
        suspendedAt: deleteField(),
        suspensionReason: deleteField(),
      });
    });
    await assertSucceeds(upload(as('camila'), await reservedPath(), jpeg));
  });

  it('png, webp e image/jpeg com parâmetro não sobem', async () => {
    for (const contentType of [
      'image/png',
      'image/webp',
      'image/jpeg; charset=utf-8',
      'image/jpg',
    ]) {
      await assertFails(upload(as('camila'), await reservedPath(), { contentType }));
    }
  });

  it('até 1 MiB passa; acima, não; vazio, não', async () => {
    await assertSucceeds(upload(as('camila'), await reservedPath(), { ...jpeg, size: MB }));
    await assertFails(upload(as('camila'), await reservedPath(), { ...jpeg, size: MB + 1 }));
    await assertFails(upload(as('camila'), await reservedPath(), { ...jpeg, size: 0 }));
  });

  it('nome fora do formato e subpasta não sobem, nem com a vaga do nome', async () => {
    for (const name of [
      'avatar.jpg',
      'photo-ABCDEFGH.jpg',
      'photo-a.jpg',
      'photo-mg5k2x1a-4f9z0abc.jpeg',
      `photo-${'a'.repeat(41)}.jpg`,
    ]) {
      await reserveSlot('camila', `fans/camila/${name}`);
      await assertFails(upload(as('camila'), `fans/camila/${name}`, jpeg));
    }
    await reserveSlot('camila', 'fans/camila/sub/photo-mg5k2x1a-0001.jpg');
    await assertFails(upload(as('camila'), 'fans/camila/sub/photo-mg5k2x1a-0001.jpg', jpeg));
  });

  it('o mesmo nome duas vezes não sobe (sem sobrescrever), mesmo com a vaga aberta', async () => {
    const path = await reservedPath();
    await assertSucceeds(upload(as('camila'), path, jpeg));
    await assertFails(upload(as('camila'), path, jpeg));
  });

  it('a dona baixa e lê os metadados pelo caminho; outro fã e sem login, não', async () => {
    const path = await reservedPath();
    await assertSucceeds(upload(as('camila'), path, jpeg));
    await assertSucceeds(as('camila').ref(path).getMetadata());
    await assertSucceeds(as('camila').ref(path).getDownloadURL());
    await assertFails(as('alan').ref(path).getMetadata());
    await assertFails(anonymous().ref(path).getMetadata());
  });

  it('ninguém lista, troca metadados nem apaga, nem a dona nem a admin', async () => {
    const path = await reservedPath();
    await assertSucceeds(upload(as('camila'), path, jpeg));
    for (const storage of [as('camila'), as('admin')]) {
      await assertFails(storage.ref('fans/camila').listAll());
      await assertFails(storage.ref(path).delete());
      await assertFails(storage.ref(path).updateMetadata({ contentType: 'image/png' }));
    }
  });
});

// --- Foto das recompensas da loja (bloco 10, 25.10) -------------------------------------

/** Recompensa gravada como o createReward grava (o que importa às regras é existir). */
async function seedReward(rewardId: string): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `rewards/${rewardId}`), {
      kind: 'ticket',
      title: 'Par de ingressos',
      status: 'draft',
      photo: null,
    });
  });
}

const rewardPath = (rewardId = 'ingressos') =>
  `rewards/${rewardId}/photo-${Date.now()}-${++counter}-1200.webp`;

describe('foto das recompensas (rewards/{id}/)', () => {
  beforeEach(() => seedReward('ingressos'));

  it('a editora com rewards e a admin sobem uma imagem de até 5 MB para uma recompensa que existe', async () => {
    await assertSucceeds(upload(as('editoraLoja'), rewardPath(), { size: 5 * MB }));
    await assertSucceeds(upload(as('admin'), rewardPath()));
    await assertSucceeds(upload(as('editoraLoja'), rewardPath(), { contentType: 'image/jpeg' }));
  });

  it('a leitora com rewards, a editora só com artists, o fã e sem login não sobem', async () => {
    for (const uid of ['leitoraLoja', 'editora', 'editorSemSecao', 'desativada', 'fa']) {
      await assertFails(upload(as(uid), rewardPath()));
    }
    await assertFails(upload(anonymous(), rewardPath()));
  });

  it('recompensa que não existe, tipo fora, acima de 5 MB, vazio e o mesmo nome duas vezes não sobem', async () => {
    await assertFails(upload(as('editoraLoja'), rewardPath('nao-existe')));
    await assertFails(upload(as('editoraLoja'), rewardPath('__x__')));
    await assertFails(upload(as('editoraLoja'), rewardPath(), { contentType: 'image/gif' }));
    await assertFails(upload(as('editoraLoja'), rewardPath(), { contentType: 'video/mp4' }));
    await assertFails(upload(as('editoraLoja'), rewardPath(), { size: 5 * MB + 1 }));
    await assertFails(upload(as('editoraLoja'), rewardPath(), { size: 0 }));
    await assertFails(upload(as('editoraLoja'), `rewards/ingressos/sub/photo-${++counter}.webp`));
    const path = rewardPath();
    await assertSucceeds(upload(as('editoraLoja'), path));
    await assertFails(upload(as('editoraLoja'), path));
  });

  it('qualquer um baixa pelo caminho; ninguém lista, troca nem apaga', async () => {
    const path = rewardPath();
    await assertSucceeds(upload(as('editoraLoja'), path));
    for (const storage of [anonymous(), as('fa'), as('admin')]) {
      await assertSucceeds(storage.ref(path).getMetadata());
    }
    for (const storage of [as('fa'), as('editoraLoja'), as('admin')]) {
      await assertFails(storage.ref('rewards/ingressos').listAll());
      await assertFails(storage.ref(path).delete());
      await assertFails(storage.ref(path).updateMetadata({ contentType: 'image/png' }));
    }
  });
});
