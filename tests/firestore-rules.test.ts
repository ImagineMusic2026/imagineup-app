import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  orderBy,
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
 * Regras do Firestore contra o emulador. Rode com `npm run test:rules`, que sobe
 * o emulador (firebase-tools 15 exige Java 21 ou mais novo) e roda estes testes.
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

const fan = () => env.authenticatedContext('fa').firestore();
const otherFan = () => env.authenticatedContext('outro').firestore();
const anonymous = () => env.unauthenticatedContext().firestore();

const MINUTE_AGO = () => Timestamp.fromMillis(Date.now() - 60_000);

/** Perfil criado pelo servidor, com campos que só ele grava. */
async function seedProfile(extra: Record<string, unknown> = {}): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users/fa'), {
      displayName: 'Camila',
      city: 'Feira de Santana, BA',
      photoURL: 'https://firebasestorage.googleapis.com/avatar.jpg',
      createdAt: Timestamp.fromDate(new Date('2026-09-01')),
      updatedAt: MINUTE_AGO(),
      points: 12480,
      level: 7,
      username: 'camilarib',
      ...extra,
    });
  });
}

/**
 * O perfil como o servidor cria quando o nome do cadastro não passou (o
 * formato do createProfile, functions/src/store.ts): sem nome e sem updatedAt.
 */
async function seedNamelessProfile(extra: Record<string, unknown> = {}): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users/fa'), {
      displayName: null,
      username: 'fa123456',
      city: null,
      photoURL: null,
      createdAt: Timestamp.now(),
      ...extra,
    });
  });
}

const edit = (data: Record<string, unknown>) =>
  updateDoc(doc(fan(), 'users/fa'), { ...data, updatedAt: serverTimestamp() });

/**
 * A única gravação do fã no perfil desde o perfil novo (docs/arquitetura-api.md,
 * seção 28): a do fillMissingProfileName (src/domains/auth/api.ts), o nome e o
 * horário do servidor no perfil que nasceu sem nome.
 */
const firstName = (displayName: unknown) => edit({ displayName });

/** Código de cada caractere, para a falha dizer qual valor escapou. */
const codePoints = (value: unknown) =>
  typeof value === 'string'
    ? [...value]
        .map(
          (char) => `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`,
        )
        .join(' ')
    : String(value);

/** A mesma checagem do primeiro nome para cada valor, cada um num perfil sem nome novo. */
async function checkEachName(values: unknown[], check: typeof assertFails): Promise<void> {
  for (const value of values) {
    await env.clearFirestore();
    await seedNamelessProfile();
    try {
      await check(firstName(value));
    } catch (error) {
      throw new Error(`displayName = [${codePoints(value)}]: ${(error as Error).message}`);
    }
  }
}

describe('perfil do fã (users/{uid})', () => {
  it('o celular não cria perfil: ele nasce no servidor, no cadastro', async () => {
    await assertFails(
      setDoc(doc(fan(), 'users/fa'), { displayName: 'Camila', createdAt: serverTimestamp() }),
    );
  });

  it('o fã lê só o próprio perfil, e nenhum fã lista os perfis', async () => {
    await seedProfile();
    await assertSucceeds(getDoc(doc(fan(), 'users/fa')));
    await assertFails(getDoc(doc(otherFan(), 'users/fa')));
    await assertFails(getDoc(doc(anonymous(), 'users/fa')));
    await assertFails(getDocs(collection(fan(), 'users')));
    await assertFails(getDocs(query(collection(fan(), 'users'), where('suspendedAt', '!=', null))));
  });

  it('o fã suspenso sem nome não grava o primeiro nome, e grava depois que a suspensão sai (bloco 11)', async () => {
    await seedNamelessProfile({ suspendedAt: MINUTE_AGO(), suspensionReason: 'spam' });
    await assertSucceeds(getDoc(doc(fan(), 'users/fa')));
    await assertFails(firstName('Camila R.'));
    // Nem tira a própria suspensão.
    await assertFails(edit({ suspendedAt: deleteField(), suspensionReason: deleteField() }));
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'users/fa'), {
        suspendedAt: deleteField(),
        suspensionReason: deleteField(),
      });
    });
    await assertSucceeds(firstName('Camila R.'));
  });

  it('o fã não grava a própria suspensão nem as chaves da busca (bloco 11)', async () => {
    await seedProfile();
    await assertFails(edit({ suspendedAt: Timestamp.now() }));
    await assertFails(edit({ suspensionReason: 'other' }));
    await assertFails(edit({ searchKeys: ['ca', 'cam'] }));
  });

  it('o fã não edita nome nem cidade pelo celular: vão pela API (PUT /me/profile, seção 28)', async () => {
    await seedProfile();
    await assertFails(edit({ displayName: 'Camila R.', city: 'Irará, BA' }));
    await assertFails(edit({ displayName: 'Camila R.' }));
    await assertFails(edit({ city: 'Irará, BA' }));
  });

  it('o fã não limpa a cidade pelo celular', async () => {
    await seedProfile();
    await assertFails(edit({ city: null }));
  });

  it('o primeiro nome leva o horário do servidor', async () => {
    await seedNamelessProfile();
    await assertFails(updateDoc(doc(fan(), 'users/fa'), { displayName: 'Sem horário' }));
    await assertFails(
      updateDoc(doc(fan(), 'users/fa'), { displayName: 'Camila', updatedAt: new Date() }),
    );
    await assertFails(
      updateDoc(doc(fan(), 'users/fa'), { displayName: 'Camila', updatedAt: MINUTE_AGO() }),
    );
  });

  it('o perfil como o servidor cria (sem nome e sem updatedAt) recebe o nome do cadastro, uma vez só', async () => {
    // O formato de createProfile (functions/src/store.ts) e a gravação de
    // fillMissingProfileName (src/domains/auth/api.ts), quando o nome chegou
    // depois da espera da função de cadastro.
    await seedNamelessProfile();
    // Com a cidade junto, não: só o nome e o horário.
    await assertFails(edit({ displayName: 'Beatriz Santos', city: 'Irará, BA' }));
    await assertSucceeds(firstName('Beatriz Santos'));
    // Com o nome gravado, a regra não deixa outra gravação.
    await assertFails(firstName('Beatriz S.'));
    await assertFails(edit({ city: 'Irará, BA' }));
  });

  it('o fã não grava a bio, o gênero, a conta privada, as redes, o @ nem o updatedAt sozinho (seção 28)', async () => {
    for (const seed of [() => seedProfile(), () => seedNamelessProfile()]) {
      await env.clearFirestore();
      await seed();
      for (const change of [
        { bio: 'Feira de Santana.' },
        { bio: null },
        { gender: 'woman' },
        { gender: null },
        { privateAccount: true },
        { socials: { instagram: 'camila.teste.up', tiktok: null, linkedin: null, x: null } },
        { socials: null },
        { username: 'camilanova' },
        // Só o updatedAt.
        {},
      ]) {
        await assertFails(edit(change));
      }
      // Nem junto do primeiro nome.
      await assertFails(edit({ displayName: 'Camila', bio: 'Feira de Santana.' }));
      await assertFails(edit({ displayName: 'Camila', privateAccount: true }));
    }
  });

  it('o fã não mexe em pontos, nível, @, foto nem na data de criação', async () => {
    await seedProfile();
    for (const change of [
      { points: 999999 },
      { level: 99 },
      { username: 'outro' },
      { role: 'admin' },
      { photoURL: 'https://evil.example/pixel.gif' },
      { createdAt: serverTimestamp() },
      // Bloco 9: o caminho e a data da foto e o prazo do @ são do servidor.
      { photoPath: 'fans/fa/photo-mg5k2x1a-4f9z0abc.jpg' },
      { photoUpdatedAt: serverTimestamp() },
      { usernameChangedAt: serverTimestamp() },
      { usernameChangeableAt: null },
      { usernameChangeableAt: Timestamp.fromMillis(0) },
    ]) {
      await assertFails(edit(change));
    }
  });

  it('o perfil sem nome com a foto e o prazo do @ gravados pelo servidor aceita o primeiro nome; com nome, recusa (bloco 9)', async () => {
    const serverFields = {
      photoPath: 'fans/fa/photo-mg5k2x1a-4f9z0abc.jpg',
      photoUpdatedAt: MINUTE_AGO(),
      usernameChangedAt: MINUTE_AGO(),
      usernameChangeableAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
    await seedNamelessProfile(serverFields);
    await assertSucceeds(firstName('Camila Ribeiro'));
    await env.clearFirestore();
    await seedProfile(serverFields);
    await assertFails(firstName('Camila Ribeiro'));
    await assertFails(edit({ displayName: 'Camila Ribeiro', city: 'Irará, BA' }));
  });

  it('as reservas de @ (usernames/) são só do servidor: nem a própria, nem a de outro, nem a de uma central', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'usernames/camilarib'), { uid: 'fa', createdAt: Timestamp.now() });
      await setDoc(doc(db, 'usernames/alanzin'), { uid: 'outro', createdAt: Timestamp.now() });
      await setDoc(doc(db, 'usernames/nenho'), { artistId: 'nenho', createdAt: Timestamp.now() });
    });
    for (const id of ['camilarib', 'alanzin', 'nenho', 'livre123']) {
      await assertFails(getDoc(doc(fan(), `usernames/${id}`)));
      await assertFails(setDoc(doc(fan(), `usernames/${id}`), { uid: 'fa' }));
      await assertFails(deleteDoc(doc(fan(), `usernames/${id}`)));
    }
    await assertFails(getDocs(collection(fan(), 'usernames')));
  });

  it('o orçamento da fila das cópias (users/{uid}/profileSync) é só do servidor, nem o próprio fã', async () => {
    await seedProfile();
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/fa/profileSync/budget'), {
        day: '2026-10-07',
        windows: 1,
        lastWindow: 1,
      });
    });
    await assertFails(getDoc(doc(fan(), 'users/fa/profileSync/budget')));
    await assertFails(getDocs(collection(fan(), 'users/fa/profileSync')));
    await assertFails(
      setDoc(doc(fan(), 'users/fa/profileSync/budget'), { day: '2026-10-07', windows: 0 }),
    );
    await assertFails(getDoc(doc(otherFan(), 'users/fa/profileSync/budget')));
    // Nem a equipe: admin ativa, com todas as seções (inclusive fans).
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'staff/admin'), {
        uid: 'admin',
        role: 'admin',
        status: 'active',
        sections: [
          'overview',
          'growth',
          'ranking',
          'fans',
          'artists',
          'missions',
          'rewards',
          'moderation',
          'audit',
        ],
        accountCreatedByInvite: true,
      });
    });
    const admin = env.authenticatedContext('admin').firestore();
    await assertFails(getDoc(doc(admin, 'users/fa/profileSync/budget')));
  });

  it('a vaga de envio da foto (users/{uid}/uploads/photo, 27.4) é só do servidor: o fã não grava a própria', async () => {
    // O teto do dia e o prazo dependem disto: um fã que gravasse a vaga
    // subiria arquivos sem contar, com o prazo que quisesse.
    await seedProfile();
    const slot = {
      fileName: 'photo-mg5k2x1a-00000001.jpg',
      expiresAt: Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60_000),
      createdAt: Timestamp.now(),
    };
    await assertFails(setDoc(doc(fan(), 'users/fa/uploads/photo'), slot));
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/fa/uploads/photo'), slot);
    });
    await assertFails(getDoc(doc(fan(), 'users/fa/uploads/photo')));
    await assertFails(getDocs(collection(fan(), 'users/fa/uploads')));
    await assertFails(
      updateDoc(doc(fan(), 'users/fa/uploads/photo'), { fileName: 'photo-outro-0000001.jpg' }),
    );
    await assertFails(deleteDoc(doc(fan(), 'users/fa/uploads/photo')));
    await assertFails(setDoc(doc(otherFan(), 'users/fa/uploads/photo'), slot));
  });

  it('não apaga campos do servidor', async () => {
    await seedProfile();
    await assertFails(edit({ points: deleteField() }));
    await assertFails(
      setDoc(doc(fan(), 'users/fa'), { displayName: 'Camila', updatedAt: serverTimestamp() }),
    );
  });

  it('o primeiro nome é obrigatório e não pode ser vazio, invisível ou quebrado', async () => {
    await seedNamelessProfile();
    for (const displayName of [
      '',
      ' ',
      ' Camila',
      'Camila ',
      'x'.repeat(61),
      '\u200B',
      '\u3164',
      'A\nB',
      '\u202Egpj.exe',
      'a\u0000b',
      42,
      null,
    ]) {
      await assertFails(firstName(displayName));
    }
    await assertFails(edit({ displayName: deleteField() }));
  });

  it('o nome não pode ser só caractere em branco, nem começar por acento solto', async () => {
    // Inclui os que o motor de regras não conhece como controle ou acento
    // (Unicode 6.0) e que o aparelho desenha em branco.
    await checkEachName(
      [
        '\u034F',
        '\uFE0F',
        '\u180B',
        '\u{E0100}',
        '\u0301',
        '\u0301Camila',
        '\u2065',
        '\u2066',
        '\u061C',
        '\uFFF0',
        '\u180F',
        '\u{E0000}',
        '\u{16FE4}',
        '\u{1D159}',
        '\u1AB0',
        '\u1DF6',
        '\u17B4',
        'Camila\u17B5',
        '\u{1BCA0}',
        'Camila\u{1BCA3}',
        '\u{13430}',
        '\u2800',
        '\u115F',
        '\u1160',
        '\uFFA0',
        '\u180E',
      ],
      assertFails,
    );
  });

  it('o nome fica numa linha só', async () => {
    await checkEachName(['Camila\u2028Oficial', 'A\u2029B'], assertFails);
  });

  it('recusa acento empilhado (texto "zalgo")', async () => {
    await checkEachName(
      [
        'a' + '\u0336'.repeat(59),
        'Camila' + '\u0489'.repeat(40),
        'a' + '\u1DF6'.repeat(20),
        'a' + '\u1AC1'.repeat(20),
        'a' + '\u030D\u030E\u0304\u1AC1'.repeat(10),
      ],
      assertFails,
    );
  });

  it('aceita emoji composto (ZWJ), como a cantora e o coração em chamas', async () => {
    await checkEachName(
      [
        'Camila \u{1F469}\u200D\u{1F3A4}',
        'Camila \u{1F469}\u{1F3FD}\u200D\u{1F3A4}',
        'Camila \u{1F9D1}\u200D\u{1F3A4}',
        'Camila \u{1F64B}\u200D♀\uFE0F',
        'Camila ❤\uFE0F\u200D\u{1F525}',
        'Camila ❤\uFE0F\u200D\u{1FA79}',
        'Camila \u{1F3F3}\uFE0F\u200D\u{1F308}',
        'Camila \u{1F3F3}\uFE0F\u200D⚧\uFE0F',
        '\u{1F468}\u200D\u{1F469}\u200D\u{1F467} Silva',
        'Camila \u{1F9D1}\u200D\u{1F91D}\u200D\u{1F9D1}',
        'Camila \u{1F642}\u200D↔\uFE0F',
      ],
      assertSucceeds,
    );
  });

  it('o ZWJ fora de emoji continua recusado', async () => {
    await checkEachName(
      [
        'A\u200DB',
        'A\u200D\u200DB',
        'Camila\u200D',
        '\u200DCamila',
        '\u{1F3A4}\u200D',
        'A\u200D\u{1F3A4}',
      ],
      assertFails,
    );
  });

  it('aceita nomes reais: acento, outras escritas e emoji', async () => {
    await checkEachName(
      [
        'Camila Ribeiro 🎶',
        'Camila ❤\uFE0F',
        'Nº 1\uFE0F\u20E3',
        '1\uFE0F\u20E3 Camila',
        'Nguyễn Thị Ánh',
        'Nguyễn Thị Ánh'.normalize('NFD'),
        'Cámila José'.normalize('NFD'),
        'प्रिया',
        'กิ่ง',
        'שָּׁלוֹם',
        'محمد',
        '张伟',
        'Camila \u{1F1E7}\u{1F1F7}',
        'Camila \u{1F44D}\u{1F3FD}',
        "D'Ávila-Souza Jr.",
        'x'.repeat(60),
      ],
      assertSucceeds,
    );
  });

  it('ninguém apaga o perfil pelo celular', async () => {
    await seedProfile();
    await assertFails(deleteDoc(doc(fan(), 'users/fa')));
  });

  it('outra pessoa não grava o perfil, nem o primeiro nome do perfil sem nome', async () => {
    await seedNamelessProfile();
    await assertFails(
      updateDoc(doc(otherFan(), 'users/fa'), {
        displayName: 'Hacker',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('subcoleções do próprio perfil também são do servidor', async () => {
    await seedProfile();
    await assertFails(getDoc(doc(fan(), 'users/fa/resgates/1')));
    await assertFails(setDoc(doc(fan(), 'users/fa/resgates/1'), { recompensa: 'camisa' }));
  });
});

// --- A equipe e o perfil do fã (bloco 11, docs/arquitetura-api.md, 26.10) ----------------------

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
  editora: { role: 'editor', status: 'active', sections: ['fans', 'missions', 'rewards'] },
  leitor: { role: 'viewer', status: 'active', sections: ['fans'] },
  moderacao: { role: 'editor', status: 'active', sections: ['moderation'] },
  leitorModeracao: { role: 'viewer', status: 'active', sections: ['moderation'] },
  semSecao: { role: 'editor', status: 'active', sections: ['artists', 'missions', 'audit'] },
  desativada: { role: 'editor', status: 'disabled', sections: ['fans', 'moderation'] },
  pendente: { role: 'admin', status: 'pending' },
  ligada: {
    role: 'editor',
    status: 'active',
    sections: ['fans', 'moderation'],
    authValidAfter: LINKED_AT,
  },
};

/** A equipe, a fã de sempre e dois perfis a mais (um suspenso), como o servidor grava. */
async function seedTeamAndFans(): Promise<void> {
  await seedProfile();
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
        ...(member.authValidAfter === undefined ? {} : { authValidAfter: member.authValidAfter }),
      });
    }
    await setDoc(doc(db, 'users/outro'), {
      displayName: 'Alan',
      username: 'alanzin',
      createdAt: Timestamp.fromDate(new Date('2026-09-30')),
      searchKeys: ['al', 'ala', 'alan', 'alanz', 'alanzi', 'alanzin'],
    });
    await setDoc(doc(db, 'users/suspenso'), {
      displayName: 'Promo Seguidores',
      username: 'promoseg',
      createdAt: Timestamp.fromDate(new Date('2026-10-01')),
      suspendedAt: MINUTE_AGO(),
      suspensionReason: 'spam',
    });
  });
}

const staffDb = (uid: string, authTime?: number) =>
  env
    .authenticatedContext(uid, authTime === undefined ? undefined : { auth_time: authTime })
    .firestore();

type Db = ReturnType<typeof fan>;

const suspendedQuery = (db: Db) =>
  query(collection(db, 'users'), where('suspendedAt', '!=', null), orderBy('suspendedAt', 'desc'));

describe('perfil do fã pela equipe (bloco 11)', () => {
  beforeEach(seedTeamAndFans);

  it('a equipe com fans (editora e leitor) e o admin leem e listam todos os perfis, também pela busca', async () => {
    for (const uid of ['admin', 'editora', 'leitor']) {
      const db = staffDb(uid);
      await assertSucceeds(getDoc(doc(db, 'users/fa')));
      await assertSucceeds(getDoc(doc(db, 'users/suspenso')));
      await assertSucceeds(getDocs(collection(db, 'users')));
      await assertSucceeds(getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc'))));
      await assertSucceeds(
        getDocs(query(collection(db, 'users'), where('searchKeys', 'array-contains', 'alan'))),
      );
      await assertSucceeds(getDocs(suspendedQuery(db)));
    }
    await assertSucceeds(getDocs(collection(staffDb('ligada', LINKED_AT), 'users')));
  });

  it('com só moderation, lê qualquer perfil e lista só com o filtro dos suspensos', async () => {
    for (const uid of ['moderacao', 'leitorModeracao']) {
      const db = staffDb(uid);
      await assertSucceeds(getDoc(doc(db, 'users/fa')));
      await assertSucceeds(getDoc(doc(db, 'users/outro')));
      const suspended = await assertSucceeds(getDocs(suspendedQuery(db)));
      expect(suspended.docs.map((item) => item.id)).toEqual(['suspenso']);
      await assertSucceeds(
        getDocs(query(collection(db, 'users'), where('suspendedAt', '!=', null))),
      );
      await assertFails(getDocs(collection(db, 'users')));
      await assertFails(getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc'))));
      await assertFails(
        getDocs(query(collection(db, 'users'), where('searchKeys', 'array-contains', 'alan'))),
      );
      await assertFails(getDocs(query(collection(db, 'users'), where('suspendedAt', '==', null))));
    }
  });

  it('sem as duas seções, desativada, pendente ou com sessão de antes do authValidAfter, não lê nem lista', async () => {
    for (const uid of ['semSecao', 'desativada', 'pendente']) {
      const db = staffDb(uid);
      await assertFails(getDoc(doc(db, 'users/fa')));
      await assertFails(getDocs(collection(db, 'users')));
      await assertFails(getDocs(suspendedQuery(db)));
    }
    const stale = staffDb('ligada', LINKED_AT - 1);
    await assertFails(getDoc(doc(stale, 'users/fa')));
    await assertFails(getDocs(suspendedQuery(stale)));
  });

  it('ninguém da equipe grava no perfil, nem admin: suspender é do servidor', async () => {
    for (const uid of ['admin', 'editora', 'moderacao']) {
      const db = staffDb(uid);
      await assertFails(
        updateDoc(doc(db, 'users/fa'), { displayName: 'Outra', updatedAt: serverTimestamp() }),
      );
      await assertFails(updateDoc(doc(db, 'users/fa'), { suspendedAt: serverTimestamp() }));
      await assertFails(updateDoc(doc(db, 'users/suspenso'), { suspendedAt: deleteField() }));
      await assertFails(setDoc(doc(db, 'users/novo'), { displayName: 'Novo' }));
      await assertFails(deleteDoc(doc(db, 'users/outro')));
    }
  });

  it('o orçamento do dia da equipe (staffLimits) é só do servidor, nem admin lê', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'staffLimits/editora_2026-10-07'), {
        uid: 'editora',
        day: '2026-10-07',
        adjusted: { balance: 100 },
        emailLookups: 1,
      });
    });
    for (const uid of ['admin', 'editora']) {
      const db = staffDb(uid);
      await assertFails(getDoc(doc(db, 'staffLimits/editora_2026-10-07')));
      await assertFails(getDocs(collection(db, 'staffLimits')));
      await assertFails(setDoc(doc(db, 'staffLimits/editora_2026-10-07'), { emailLookups: 0 }));
    }
  });
});

describe('todo o resto é do servidor', () => {
  // artists/ (o fã lê as publicadas) tem os testes em artists-rules.test.ts.
  it.each([
    'artistPrivate/netto',
    'posts/1',
    'wallets/fa',
    'missions/diaria',
    'invites/ABC123',
    'rankings/geral',
    'usernames/camilarib',
    'staff/x',
    'staffInvites/x',
    'staffAudit/x',
  ])('%s: o celular não lê nem grava', async (path) => {
    await assertFails(getDoc(doc(fan(), path)));
    await assertFails(setDoc(doc(fan(), path), { qualquer: 1 }));
  });
});
