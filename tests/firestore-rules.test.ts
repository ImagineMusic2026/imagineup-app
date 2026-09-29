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
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
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

const edit = (data: Record<string, unknown>) =>
  updateDoc(doc(fan(), 'users/fa'), { ...data, updatedAt: serverTimestamp() });

/** Código de cada caractere, para a falha dizer qual valor escapou. */
const codePoints = (value: unknown) =>
  typeof value === 'string'
    ? [...value]
        .map(
          (char) => `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`,
        )
        .join(' ')
    : String(value);

/** A mesma checagem para cada valor, cada um num perfil novo (a trava de 10 s não interfere). */
async function checkEach(
  field: 'displayName' | 'city',
  values: unknown[],
  check: typeof assertFails,
): Promise<void> {
  for (const value of values) {
    await env.clearFirestore();
    await seedProfile();
    try {
      await check(edit({ [field]: value }));
    } catch (error) {
      throw new Error(`${field} = [${codePoints(value)}]: ${(error as Error).message}`);
    }
  }
}

describe('perfil do fã (users/{uid})', () => {
  it('o celular não cria perfil: ele nasce no servidor, no cadastro', async () => {
    await assertFails(
      setDoc(doc(fan(), 'users/fa'), { displayName: 'Camila', createdAt: serverTimestamp() }),
    );
  });

  it('só o próprio fã lê o perfil, e ninguém lista os perfis', async () => {
    await seedProfile();
    await assertSucceeds(getDoc(doc(fan(), 'users/fa')));
    await assertFails(getDoc(doc(otherFan(), 'users/fa')));
    await assertFails(getDoc(doc(anonymous(), 'users/fa')));
    await assertFails(getDocs(collection(fan(), 'users')));
  });

  it('o fã edita nome e cidade', async () => {
    await seedProfile();
    await assertSucceeds(edit({ displayName: 'Camila R.', city: 'Irará, BA' }));
  });

  it('o fã limpa a cidade', async () => {
    await seedProfile();
    await assertSucceeds(edit({ city: null }));
  });

  it('toda edição leva o horário do servidor', async () => {
    await seedProfile();
    await assertFails(updateDoc(doc(fan(), 'users/fa'), { displayName: 'Sem horário' }));
    await assertFails(
      updateDoc(doc(fan(), 'users/fa'), { displayName: 'Camila', updatedAt: new Date() }),
    );
  });

  it('segura edições em rajada: no máximo uma a cada 10 segundos', async () => {
    await seedProfile({ updatedAt: Timestamp.now() });
    await assertFails(edit({ displayName: 'De novo' }));
  });

  it('um updatedAt que não é data, gravado pelo servidor, não trava o perfil', async () => {
    for (const updatedAt of [null, Date.now() - 60_000, '2026-09-01T00:00:00Z']) {
      await env.clearFirestore();
      await seedProfile({ updatedAt });
      await assertSucceeds(edit({ displayName: 'Camila R.' }));
      // Depois da edição a trava volta a valer.
      await assertFails(edit({ displayName: 'De novo' }));
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
    ]) {
      await assertFails(edit(change));
    }
  });

  it('não apaga campos do servidor', async () => {
    await seedProfile();
    await assertFails(edit({ points: deleteField() }));
    await assertFails(
      setDoc(doc(fan(), 'users/fa'), { displayName: 'Camila', updatedAt: serverTimestamp() }),
    );
  });

  it('o nome é obrigatório e não pode ser vazio, invisível ou quebrado', async () => {
    await seedProfile();
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
      await assertFails(edit({ displayName }));
    }
    await assertFails(edit({ displayName: deleteField() }));
  });

  it('o nome não pode ser só caractere em branco, nem começar por acento solto', async () => {
    // Inclui os que o motor de regras não conhece como controle ou acento
    // (Unicode 6.0) e que o aparelho desenha em branco.
    await checkEach(
      'displayName',
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
    await checkEach('displayName', ['Camila\u2028Oficial', 'A\u2029B'], assertFails);
  });

  it('recusa acento empilhado (texto "zalgo")', async () => {
    await checkEach(
      'displayName',
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
    await checkEach(
      'displayName',
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
    await checkEach(
      'displayName',
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
    await checkEach(
      'displayName',
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

  it('valida a cidade', async () => {
    await checkEach(
      'city',
      [
        'x'.repeat(81),
        'Irará\u0000',
        42,
        '',
        '   ',
        ' Irará, BA',
        'Irará, BA ',
        'Irará\u2028BA',
        '\u034F',
        '\u2065',
        'A\u2067B',
      ],
      assertFails,
    );
    await checkEach(
      'city',
      [
        'Irará, BA',
        'São João del-Rei, MG',
        'São Paulo, SP'.normalize('NFD'),
        "Olho-d'Água das Flores, AL",
        'Salvador \u{1F3F3}\uFE0F\u200D\u{1F308}',
      ],
      assertSucceeds,
    );
  });

  it('um valor do servidor fora do padrão não trava a edição de outro campo', async () => {
    // Nome longo vindo do login da Apple, gravado pelo servidor.
    await seedProfile({ city: null, displayName: 'x'.repeat(70) });
    await assertSucceeds(edit({ city: 'Irará, BA' }));
  });

  it('ninguém apaga o perfil pelo celular', async () => {
    await seedProfile();
    await assertFails(deleteDoc(doc(fan(), 'users/fa')));
  });

  it('outra pessoa não edita o perfil', async () => {
    await seedProfile();
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

describe('todo o resto é do servidor', () => {
  it.each([
    'artists/netto',
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
