import { initializeApp } from 'firebase-admin/app';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { setTimeout as sleep } from 'node:timers/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import { FILTERED_NAME, isBlockedText } from '../src/content-filter';
import { fanSearchKeys } from '../src/fan-profile';
import { handleUserCreated, NAME_WAIT_MS, type FindUser } from '../src/handlers';
import { dayKey } from '../src/points';
import { createProfile, deleteUserData } from '../src/store';
import { barredWordOf, readLegibleList, warnWithoutList } from './content-filter-list';
import {
  signIn,
  signInWithIdp,
  signUpFan,
  useCleanEmulators,
  type IdpClaims,
  type IdpResult,
} from './support';

/**
 * Roda com `npm run test:functions`, na raiz do app: sobe os emuladores de
 * Auth, Firestore e Functions e cria contas de verdade, que disparam as funções.
 * O projeto é demo, para o emulador não falar com o imagine-up-app de verdade.
 */
const PROJECT_ID = 'demo-imagine-up-app';
const app = initializeApp({ projectId: PROJECT_ID });
const auth = getAuth(app);
const db = getFirestore(app);

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

// Se a descoberta das funções estourar o prazo, o emulators:exec só avisa no log
// e roda os testes assim mesmo, sem gatilho nenhum: falha logo, com a causa.
beforeAll(async () => {
  const hub = process.env.FIREBASE_EMULATOR_HUB;
  if (!hub) throw new Error('Rode com npm run test:functions.');
  const emulators = (await (await fetch(`http://${hub}/emulators`)).json()) as {
    functions?: { host: string; port: number };
  };
  if (!emulators.functions) throw new Error('O emulador de Functions não está rodando.');
  const { host, port } = emulators.functions;
  const { backends } = (await (await fetch(`http://${host}:${port}/backends`)).json()) as {
    backends: { functionTriggers: { entryPoint: string }[] }[];
  };
  const loaded = backends.flatMap((backend) => backend.functionTriggers.map((t) => t.entryPoint));
  const missing = ['createUserProfile', 'deleteUserProfile', 'queueFanProfileSync'].filter(
    (name) => !loaded.includes(name),
  );
  if (missing.length > 0) {
    throw new Error(
      `O emulador não carregou ${missing.join(', ')}: procure "Failed to load function definition" no log.`,
    );
  }
});

useCleanEmulators();

let accounts = 0;
const newEmail = () => `fa${++accounts}@teste.dev`;

async function waitFor<T>(what: string, read: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Tempo esgotado esperando ${what}.`);
    await sleep(200);
  }
}

const profileOf = (uid: string) =>
  waitFor(`o perfil de ${uid}`, async () => (await db.doc(`users/${uid}`).get()).data());

const isGone = (path: string) =>
  waitFor(`${path} sumir`, async () => ((await db.doc(path).get()).exists ? undefined : true));

const reservationsOf = async (uid: string) =>
  (await db.collection('usernames').where('uid', '==', uid).get()).docs.map((doc) => doc.id);

describe('cadastro (onUserCreated)', () => {
  it('cria o perfil com nome, @ e data quando a conta nasce', async () => {
    const user = await auth.createUser({
      email: newEmail(),
      password: 'segredo123',
      displayName: 'Camila Ribeiro',
    });
    const profile = await profileOf(user.uid);
    expect(profile).toMatchObject({
      displayName: 'Camila Ribeiro',
      username: 'camilarib',
      city: null,
      photoURL: null,
    });
    expect(profile.createdAt).toBeInstanceOf(Timestamp);
    // updatedAt é só o carimbo da gravação do primeiro nome pelo fã (seção 28): o servidor nunca grava.
    expect(profile).not.toHaveProperty('updatedAt');
    expect(await reservationsOf(user.uid)).toEqual(['camilarib']);
  });

  it('dois fãs com o mesmo nome ganham @ diferentes', async () => {
    const first = await auth.createUser({ email: newEmail(), displayName: 'Camila Ribeiro' });
    await profileOf(first.uid);
    const second = await auth.createUser({ email: newEmail(), displayName: 'Camila Ribeiro' });
    const profile = await profileOf(second.uid);
    expect(profile.username).toMatch(/^camilarib\d{2}$/);
  });

  it('conta criada sem nome e com o nome posto logo depois: o perfil nasce com ele e o @ dele', async () => {
    // Aquece o gatilho: com o worker frio (teste rodando sozinho, Windows, CI
    // lento), ele leva segundos para começar e já leria a conta com o nome.
    const warm = await auth.createUser({ email: newEmail(), displayName: 'Bruna Andrade' });
    await profileOf(warm.uid);

    // Como no app: o SDK JS cria a conta sem nome, e o nome chega depois, no
    // updateProfile. A função lê a conta ainda sem nome e espera por ele. Aos
    // 2,5 s, o nome cai entre as releituras de 1,75 s e de 3,75 s
    // (NAME_WAIT_MS): um gatilho que comece até uns 2,5 s atrasado ainda lê a
    // conta sem nome, e a última releitura pega o nome com folga. A espera
    // de verdade, sem depender do gatilho, é provada em handleUserCreated.
    const user = await auth.createUser({ email: newEmail(), password: 'segredo123' });
    await sleep(2_500);
    await auth.updateUser(user.uid, { displayName: 'Larissa Moura' });

    const profile = await profileOf(user.uid);
    expect(profile).toMatchObject({ displayName: 'Larissa Moura', username: 'larissamou' });
    expect(await reservationsOf(user.uid)).toEqual(['larissamou']);
  });

  it('conta sem nome ganha @ "fa" com números e nome vazio', async () => {
    // A função espera o nome (NAME_WAIT_MS) e, sem ele, cria o perfil assim mesmo.
    const user = await auth.createUser({ email: newEmail(), password: 'segredo123' });
    const profile = await profileOf(user.uid);
    expect(profile.displayName).toBeNull();
    expect(profile.username).toMatch(/^fa\d{6}$/);
  });

  it('nome e foto mandados pela API de cadastro não passam direto para o perfil', async () => {
    // Quem chama a API do Firebase direto manda o nome e a foto que quiser.
    const response = await fetch(
      `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=chave-falsa`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newEmail(),
          password: 'segredo123',
          displayName: '\u034F',
          photoUrl: 'https://evil.example/pixel.gif',
          returnSecureToken: true,
        }),
      },
    );
    const { localId } = (await response.json()) as { localId: string };
    const record = await auth.getUser(localId);
    expect(record.displayName).toBe('\u034F');

    const profile = await profileOf(localId);
    expect(profile.displayName).toBeNull();
    expect(profile.photoURL).toBeNull();
    expect(profile.username).toMatch(/^fa\d{6}$/);
  });
});

describe('exclusão da conta (onUserDeleted)', () => {
  it('apaga o perfil, as subcoleções e libera o @', async () => {
    const user = await auth.createUser({ email: newEmail(), displayName: 'Camila Ribeiro' });
    await profileOf(user.uid);
    await db.doc(`users/${user.uid}/resgates/1`).set({ recompensa: 'camisa' });

    await auth.deleteUser(user.uid);

    await isGone(`users/${user.uid}`);
    await isGone(`users/${user.uid}/resgates/1`);
    await isGone('usernames/camilarib');
  });

  it('conta excluída logo depois do cadastro não deixa perfil nem @ para trás', async () => {
    // Aquece as duas funções, para a exclusão cair perto da criação.
    const warm = await auth.createUser({ email: newEmail() });
    await profileOf(warm.uid);
    await auth.deleteUser(warm.uid);
    await isGone(`users/${warm.uid}`);

    // A exclusão chega de 0 a 44 ms depois do cadastro, com as funções de verdade.
    // A ordem exata entre as duas não é controlável aqui: a corrida no meio da
    // criação é provada abaixo, em handleUserCreated.
    const uids: string[] = [];
    for (let delay = 0; delay <= 44; delay += 4) {
      const user = await auth.createUser({ email: newEmail(), displayName: 'Bruna Andrade' });
      await sleep(delay);
      await auth.deleteUser(user.uid);
      uids.push(user.uid);
    }

    // O @ puro volta a ficar livre para a próxima Bruna Andrade. Ele entra na
    // mesma espera: a transação do perfil também soma o cadastro no shard do
    // dia (bloco 5), e nesta rajada de contas o último perfil pode gravar
    // depois da primeira conferência, sumindo logo em seguida pelo "undone".
    // Sobra de verdade (um @ que nunca sai) estoura a espera e falha.
    await waitFor('as sobras das contas excluídas sumirem', async () => {
      const leftovers = await Promise.all(
        uids.map(
          async (uid) =>
            (await db.doc(`users/${uid}`).get()).exists || (await reservationsOf(uid)).length > 0,
        ),
      );
      const pureHandleTaken = (await db.doc('usernames/brunaand').get()).exists;
      return leftovers.some(Boolean) || pureHandleTaken ? undefined : true;
    });
    expect((await db.doc('usernames/brunaand').get()).exists).toBe(false);
  });
});

describe('handleUserCreated', () => {
  // A consulta ao Auth é simulada: cada teste decide se a conta existe a cada conferência.
  const answers =
    (...found: boolean[]): FindUser =>
    async () =>
      found.shift() ? { displayName: 'Bruna Andrade' } : null;

  it('conta excluída entre a conferência e a gravação: o perfil é desfeito', async () => {
    const result = await handleUserCreated(db, answers(true, false), { uid: 'no-meio' });
    expect(result).toEqual({ status: 'undone' });
    expect((await db.doc('users/no-meio').get()).exists).toBe(false);
    expect(await reservationsOf('no-meio')).toEqual([]);
  });

  it('nova entrega de conta excluída limpa o que a entrega anterior gravou', async () => {
    await createProfile(db, { uid: 'reentrega', displayName: 'Bruna Andrade' });
    const result = await handleUserCreated(db, answers(false), { uid: 'reentrega' });
    expect(result).toEqual({ status: 'undone' });
    expect((await db.doc('users/reentrega').get()).exists).toBe(false);
    expect(await reservationsOf('reentrega')).toEqual([]);
  });

  it('conta sem nome: relê a conta depois das esperas de verdade e o perfil nasce com o nome', async () => {
    // Sem nome nas duas primeiras leituras e com ele na terceira; a quarta é a
    // conferência depois de gravar. A espera é a padrão (NAME_WAIT_MS), não a
    // falsa dos testes unitários, e não depende de quando o gatilho começa.
    const names = [null, null, 'Larissa Moura', 'Larissa Moura'];
    const readAt: number[] = [];
    const findUser: FindUser = async () => {
      readAt.push(performance.now());
      return { displayName: names[readAt.length - 1] ?? null };
    };

    const result = await handleUserCreated(db, findUser, { uid: 'nome-na-espera' });

    expect(result).toEqual({ status: 'created', username: 'larissamou' });
    expect(readAt).toHaveLength(4);
    // O timer do Node pode disparar um tico antes do pedido: 10 ms de folga.
    expect(readAt[1] - readAt[0]).toBeGreaterThanOrEqual(NAME_WAIT_MS[0] - 10);
    expect(readAt[2] - readAt[1]).toBeGreaterThanOrEqual(NAME_WAIT_MS[1] - 10);
    expect((await db.doc('users/nome-na-espera').get()).data()).toMatchObject({
      displayName: 'Larissa Moura',
      username: 'larissamou',
    });
    expect(await reservationsOf('nome-na-espera')).toEqual(['larissamou']);
  });

  it('usa o nome de agora do Auth, que o app grava logo depois de criar a conta', async () => {
    const result = await handleUserCreated(db, answers(true, true), { uid: 'nome-depois' });
    expect(result).toEqual({ status: 'created', username: 'brunaand' });
    expect((await db.doc('users/nome-depois').get()).get('displayName')).toBe('Bruna Andrade');
  });

  it('conta da equipe do painel (staff/{uid}, qualquer status) não ganha perfil nem @', async () => {
    // O aceite do convite grava a marca antes de criar a conta no Auth.
    for (const status of ['pending', 'active', 'disabled']) {
      const uid = `equipe-${status}`;
      await db.doc(`staff/${uid}`).set({ uid, status, role: 'viewer', sections: ['fans'] });
      const result = await handleUserCreated(db, answers(true, true), { uid });
      expect(result).toEqual({ status: 'staff' });
      expect((await db.doc(`users/${uid}`).get()).exists).toBe(false);
      expect(await reservationsOf(uid)).toEqual([]);
      // A marca fica: é ela que dá (ou não) o acesso ao painel.
      expect((await db.doc(`staff/${uid}`).get()).exists).toBe(true);
    }
  });

  it('fã ligada à equipe (accountCreatedByInvite false) ganha o perfil com o gatilho atrasado', async () => {
    // O cadastro no app chega aqui só depois do linkStaffInvite: a conta é de fã.
    const uid = 'fa-ligada';
    await db.doc(`staff/${uid}`).set({
      uid,
      status: 'active',
      role: 'viewer',
      sections: ['fans'],
      accountCreatedByInvite: false,
    });
    const result = await handleUserCreated(db, answers(true, true), { uid });
    expect(result).toEqual({ status: 'created', username: 'brunaand' });
    expect((await db.doc(`users/${uid}`).get()).get('displayName')).toBe('Bruna Andrade');
    expect((await db.doc(`staff/${uid}`).get()).get('status')).toBe('active');
  });
});

describe('createProfile e deleteUserData', () => {
  // Contas que não existem no Auth: nenhuma função dispara, só o código chamado aqui.

  it('duas entregas ao mesmo tempo dão um perfil e um @', async () => {
    const user = { uid: 'entrega-dupla', displayName: 'Bruna Andrade' };
    const results = await Promise.all([createProfile(db, user), createProfile(db, user)]);
    expect(results.map((result) => result.status).sort()).toEqual(['created', 'exists']);
    expect(await reservationsOf(user.uid)).toEqual(['brunaand']);
  });

  it('entrega repetida não desfaz a edição do fã', async () => {
    const user = { uid: 'entrega-atrasada', displayName: 'Bruna Andrade' };
    await createProfile(db, user);
    await db.doc(`users/${user.uid}`).update({ displayName: 'Bruna A.', city: 'Recife, PE' });

    expect(await createProfile(db, user)).toEqual({ status: 'exists' });
    expect((await db.doc(`users/${user.uid}`).get()).data()).toMatchObject({
      displayName: 'Bruna A.',
      city: 'Recife, PE',
      username: 'brunaand',
    });
  });

  it('com o @ e as variações tomados, cai no "fa" com 8 dígitos', async () => {
    const fixed = (count: number) => '7'.repeat(count);
    for (const taken of ['brunaand', 'brunaand77', 'brunaand7777']) {
      await db.doc(`usernames/${taken}`).set({ uid: 'outra-pessoa' });
    }
    const result = await createProfile(
      db,
      { uid: 'sem-sorte', displayName: 'Bruna Andrade' },
      fixed,
    );
    expect(result).toEqual({ status: 'created', username: 'fa77777777' });
  });

  it('apagar os dados da conta tira também o acesso ao painel (staff/{uid})', async () => {
    await createProfile(db, { uid: 'fa-da-equipe', displayName: 'Bruna Andrade' });
    await db
      .doc('staff/fa-da-equipe')
      .set({ uid: 'fa-da-equipe', status: 'active', role: 'admin' });
    await deleteUserData(db, 'fa-da-equipe');
    expect((await db.doc('users/fa-da-equipe').get()).exists).toBe(false);
    expect((await db.doc('staff/fa-da-equipe').get()).exists).toBe(false);
    expect(await reservationsOf('fa-da-equipe')).toEqual([]);
  });

  it('apagar os dados pode rodar mais de uma vez, até ao mesmo tempo', async () => {
    await createProfile(db, { uid: 'apagar', displayName: 'Bruna Andrade' });
    await Promise.all([deleteUserData(db, 'apagar'), deleteUserData(db, 'apagar')]);
    await deleteUserData(db, 'apagar');
    expect((await db.doc('users/apagar').get()).exists).toBe(false);
    expect(await reservationsOf('apagar')).toEqual([]);
  });

  it('a limpeza atrasada não apaga o @ que outra fã tomou depois', async () => {
    await db.doc('usernames/carlamen').set({ uid: 'fa-antiga' });
    const [stale] = (await db.collection('usernames').where('uid', '==', 'fa-antiga').get()).docs;
    // A fã antiga libera o @, e uma fã nova com o mesmo nome o reserva.
    await db.doc('usernames/carlamen').delete();
    await db.doc('usernames/carlamen').set({ uid: 'fa-nova' });

    // A exclusão atrasada da fã antiga apaga só se a reserva não mudou desde a leitura.
    await expect(stale.ref.delete({ lastUpdateTime: stale.updateTime })).rejects.toMatchObject({
      code: 9,
    });
    await deleteUserData(db, 'fa-antiga');
    expect((await db.doc('usernames/carlamen').get()).data()).toEqual({ uid: 'fa-nova' });
  });
});

describe('cadastros do dia (bloco 5, signups.total)', () => {
  /** Soma de signups.total nos shards dos dias em que o cadastro pode ter caído. */
  async function signupsSince(from: number): Promise<number> {
    let total = 0;
    for (const day of new Set([dayKey(from), dayKey(Date.now())])) {
      const shards = await db.collection(`statsDaily/${day}/statsShards`).get();
      total += shards.docs.reduce(
        (sum, doc) => sum + ((doc.get('signups.total') as number | undefined) ?? 0),
        0,
      );
    }
    return total;
  }

  it('a conta nova soma 1 no dia e nasce com a marca signupCounted', async () => {
    const from = Date.now();
    const user = await auth.createUser({ email: newEmail(), displayName: 'Camila Ribeiro' });
    const profile = await profileOf(user.uid);
    expect(profile.signupCounted).toBe(true);
    expect(await signupsSince(from)).toBe(1);
  });

  it('a entrega repetida não soma de novo', async () => {
    const from = Date.now();
    const user = { uid: 'entrega-contada', displayName: 'Bruna Andrade' };
    expect((await createProfile(db, user)).status).toBe('created');
    expect(await createProfile(db, user)).toEqual({ status: 'exists' });
    await Promise.all([createProfile(db, user), createProfile(db, user)]);
    expect(await signupsSince(from)).toBe(1);
  });

  it('conta da equipe não soma', async () => {
    const from = Date.now();
    const uid = 'equipe-sem-cadastro';
    await db.doc(`staff/${uid}`).set({ uid, status: 'pending', role: 'viewer', sections: [] });
    const result = await handleUserCreated(db, async () => ({ displayName: 'Bruna Andrade' }), {
      uid,
    });
    expect(result).toEqual({ status: 'staff' });
    expect(await signupsSince(from)).toBe(0);
  });
});

// --- O filtro do que o fã publica (seção 30, decisão 11) ----------------------

// O termo barrado, escolhido por regra na lista legível, fora de todo
// repositório; sem ela (o CI), os casos são pulados com aviso. As funções do
// emulador carregam a lista de verdade, por chaves. O termo só vive em
// memória: as conferências comparam booleanos, e nenhuma mensagem de falha
// mostra o nome barrado nem um @ feito dele.
const BARRED = barredWordOf(readLegibleList());
if (!BARRED) warnWithoutList('profile.emulator.test.ts (o nome do cadastro barrado)');

/** O perfil ficou com o "Fã", o @ automático e as chaves dos dois. */
function expectFilteredProfile(profile: Record<string, unknown> | undefined): void {
  const username = typeof profile?.username === 'string' ? profile.username : '';
  expect(profile?.displayName === FILTERED_NAME, 'o nome é o "Fã"').toBe(true);
  expect(/^fa\d{6}$/.test(username), 'o @ é o automático').toBe(true);
  expect(
    JSON.stringify(profile?.searchKeys) === JSON.stringify(fanSearchKeys(FILTERED_NAME, username)),
    'as chaves da busca são as do "Fã" e do @',
  ).toBe(true);
}

describe.skipIf(!BARRED)('o nome do cadastro barrado (seção 30, só com a lista legível)', () => {
  it('a conta com o nome barrado nasce com "Fã" e o @ fa, sem esperar o nome', async () => {
    const barred = BARRED!;
    const names = [`Camila ${barred.text}`, barred.text];
    for (const [index, name] of names.entries()) {
      expect(isBlockedText(name, 'displayName'), `nome ${index}`).toBe(true);
    }

    // Pelo gatilho de verdade (createUserProfile, o lib compilado com a lista).
    const user = await auth.createUser({
      email: newEmail(),
      password: 'segredo123',
      displayName: names[0],
    });
    const profile = await profileOf(user.uid);
    expectFilteredProfile(profile);
    // O servidor nunca grava o updatedAt (seção 28).
    expect('updatedAt' in profile).toBe(false);
    const reservations = await reservationsOf(user.uid);
    expect(reservations.length === 1 && reservations[0] === profile.username).toBe(true);

    // O nome barrado é um nome: o `hasName` não muda, e o perfil nasce sem a espera.
    for (const [index, name] of names.entries()) {
      const uid = `nomeBarrado${index}`;
      const waits: number[] = [];
      const result = await handleUserCreated(
        db,
        async () => ({ displayName: name }),
        { uid },
        (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      );
      expect(waits, `nome ${index}`).toEqual([]);
      expect(result.status, `nome ${index}`).toBe('created');
      expectFilteredProfile((await db.doc(`users/${uid}`).get()).data());
    }
  });

  it('o nome barrado gravado depois no perfil sem nome vira "Fã" pelo gatilho, sem laço', async () => {
    const barred = BARRED!;
    // O perfil sem nome, como o do cadastro lento. Sem conta no Auth, nada
    // dispara na criação; o gatilho do perfil (queueFanProfileSync) dispara na troca.
    const uid = 'semNomeBarrado';
    await createProfile(db, { uid, displayName: null });
    const ref = db.doc(`users/${uid}`);
    expect((await ref.get()).get('displayName')).toBeNull();

    // O primeiro nome como a regra firstProfileName grava (com o updatedAt),
    // pelo Admin SDK: o teste é do gatilho, e não do caminho.
    await ref.update({
      displayName: `Camila ${barred.text}`,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const written = (await ref.get()).get('updatedAt') as Timestamp;
    await waitFor('o nome virar "Fã"', async () =>
      (await ref.get()).get('displayName') === FILTERED_NAME ? true : undefined,
    );
    const first = await ref.get();
    expectFilteredProfile(first.data());
    // O servidor não mexe no updatedAt: fica o da gravação do fã.
    expect((first.get('updatedAt') as Timestamp).isEqual(written)).toBe(true);

    // Sem laço: a gravação do "Fã" dispara o gatilho de novo, que acha as
    // chaves certas e não grava nada.
    await sleep(3_000);
    const later = await ref.get();
    expect(later.updateTime!.isEqual(first.updateTime!)).toBe(true);
  });
});

// --- Entrar com a Apple e com o Google (seção 33, etapa 2) --------------------

// As provas do Auth do login social (docs/arquitetura-api.md, 33.3 e 33.10),
// sem mudar código de produção. O app entra pelo signInWithCredential do SDK
// JS, que chama o accounts:signInWithIdp com o token do provedor (o
// signInWithIdp do support.ts). O emulador aceita as claims em JSON, não
// confere o token e trata como confiável qualquer email_verified verdadeiro:
// o Google fora do Gmail é o email_verified falso. O que ele mostrou diferente
// do desenho está na 33.18, etapa 2.

type AuthBody = Pick<IdpResult, 'localId' | 'idToken' | 'email' | 'error'>;

/** Um pedido à API do Auth do emulador, como o SDK JS manda (a chave não é conferida). */
async function authApi(path: string, body: Record<string, unknown>): Promise<AuthBody> {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/${path}?key=chave-falsa`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return (await response.json()) as AuthBody;
}

/** Os provedores da conta, em ordem alfabética (o `providerData` do app). */
const providerIdsOf = async (uid: string) =>
  (await auth.getUser(uid)).providerData.map((info) => info.providerId).sort();

/** O provedor da sessão: o `signInProvider` do token, que o app lê (decisões 9, 12 e 14). */
const sessionProviderOf = async (idToken: string | undefined) =>
  (await auth.verifyIdToken(idToken ?? '')).firebase.sign_in_provider;

/** Quando os tokens de antes deixam de valer (o validSince do Auth), em ms. */
const validAfterOf = (record: UserRecord) =>
  record.tokensValidAfterTime ? Date.parse(record.tokensValidAfterTime) : 0;

/**
 * O "Esqueci minha senha" do app (o sendPasswordResetEmail do SDK JS) e o
 * link aberto pelo fã, com o código lido da lista do emulador.
 */
async function resetPasswordByEmail(email: string, newPassword: string): Promise<void> {
  const sent = await authApi('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email });
  expect(sent.error).toBeUndefined();
  const { oobCodes } = (await (
    await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT_ID}/oobCodes`)
  ).json()) as { oobCodes: { email: string; requestType: string; oobCode: string }[] };
  const oobCode = oobCodes
    .filter((code) => code.email === email && code.requestType === 'PASSWORD_RESET')
    .at(-1)?.oobCode;
  expect(oobCode).toBeDefined();
  const reset = await authApi('accounts:resetPassword', { oobCode, newPassword });
  expect(reset.error).toBeUndefined();
}

/**
 * A gravação do primeiro nome que o app faz (o `fillMissingProfileName`: o
 * `updateDoc` com o nome e o `serverTimestamp`), pelo REST do emulador do
 * Firestore com o token do fã: as regras valem. Devolve o status do commit.
 */
async function writeFirstName(idToken: string, uid: string, displayName: string): Promise<number> {
  const database = `projects/${PROJECT_ID}/databases/(default)`;
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/${database}/documents:commit`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: `${database}/documents/users/${uid}`,
              fields: { displayName: { stringValue: displayName } },
            },
            updateMask: { fieldPaths: ['displayName'] },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            currentDocument: { exists: true },
          },
        ],
      }),
    },
  );
  return response.status;
}

// Os ids no formato dos provedores: o `sub` do Google é um número, e o da
// Apple (o `user` da credencial nativa) tem três partes separadas por ponto.
const GOOGLE_SUB = '109876543210987654321';
const APPLE_SUB = '001234.5f0c2b7e9a1d4c3e8b6a0f9d2c7e1b4a.1234';
// O nonce bruto que o app manda ao Firebase (o SHA-256 dele vai à Apple). O emulador não confere.
const NONCE = 'nonce-bruto-do-app';

const googleClaims = (
  email: string,
  name: string,
  { sub = GOOGLE_SUB, verified = true } = {},
): IdpClaims => ({
  sub,
  email,
  email_verified: verified,
  name,
  picture: `https://lh3.googleusercontent.com/a/foto-${sub}`,
});

/** A Apple manda o nome só ao app, nunca no token: a conta nasce sem nome. */
const appleClaims = (email: string, sub = APPLE_SUB): IdpClaims => ({
  sub,
  email,
  email_verified: true,
});

describe('entrar com a Apple e com o Google (seção 33, as provas do Auth)', () => {
  it('o Google nasce com o nome e o @ do nome, e a foto fica só no Auth', async () => {
    const email = 'camila.ribeiro@gmail.com';
    const claims = googleClaims(email, 'Camila Ribeiro');
    const signed = await signInWithIdp('google.com', claims);
    expect(signed.isNewUser).toBe(true);
    const uid = signed.localId!;

    // O nome chega com a conta: o caminho do cadastro com nome, sem a espera.
    const profile = await profileOf(uid);
    expect(profile).toMatchObject({
      displayName: 'Camila Ribeiro',
      username: 'camilarib',
      photoURL: null,
    });
    expect(await reservationsOf(uid)).toEqual(['camilarib']);

    const record = await auth.getUser(uid);
    expect(record.email).toBe(email);
    expect(record.emailVerified).toBe(true);
    expect(record.displayName).toBe('Camila Ribeiro');
    expect(record.photoURL).toBe(claims.picture);
    expect(record.providerData.map((info) => [info.providerId, info.uid])).toEqual([
      ['google.com', GOOGLE_SUB],
    ]);
    expect(await sessionProviderOf(signed.idToken)).toBe('google.com');

    // "Criar conta com e-mail" no mesmo e-mail: o email-already-in-use do app.
    const signUp = await authApi('accounts:signUp', {
      email,
      password: 'segredo123',
      returnSecureToken: true,
    });
    expect(signUp.error?.message).toMatch(/^EMAIL_EXISTS/);
  });

  it('a Apple sem nome nasce sem nome e com o @ fa, e o nome entra depois pela regra firstProfileName', async () => {
    const signed = await signInWithIdp(
      'apple.com',
      appleClaims('x7k2m9p4qz@privaterelay.appleid.com'),
      { nonce: NONCE },
    );
    expect(signed.isNewUser).toBe(true);
    const uid = signed.localId!;

    // A função espera o nome (NAME_WAIT_MS) e, sem ele, cria o perfil assim mesmo.
    const profile = await profileOf(uid);
    expect(profile.displayName).toBeNull();
    expect(profile.username).toMatch(/^fa\d{6}$/);
    expect(profile.photoURL).toBeNull();

    // O uid da Apple no providerData é o sub do token (o `user` da credencial nativa).
    const record = await auth.getUser(uid);
    expect(record.displayName).toBeUndefined();
    expect(record.providerData.map((info) => [info.providerId, info.uid])).toEqual([
      ['apple.com', APPLE_SUB],
    ]);
    expect(await sessionProviderOf(signed.idToken)).toBe('apple.com');

    // O nome pelo caminho do app, com o token da sessão da Apple e as regras.
    expect(await writeFirstName(signed.idToken!, uid, 'Ana Souza')).toBe(200);
    const named = (await db.doc(`users/${uid}`).get()).data()!;
    expect(named).toMatchObject({ displayName: 'Ana Souza', username: profile.username });
    expect(named.updatedAt).toBeInstanceOf(Timestamp);
    // A busca do painel acha o fã pelo nome: o gatilho do perfil refaz as chaves.
    const keys = JSON.stringify(fanSearchKeys('Ana Souza', named.username as string));
    await waitFor('as chaves da busca com o nome', async () =>
      JSON.stringify((await db.doc(`users/${uid}`).get()).get('searchKeys')) === keys
        ? true
        : undefined,
    );
    // A regra só aceita o primeiro nome: a segunda gravação é recusada.
    expect(await writeFirstName(signed.idToken!, uid, 'Ana S.')).toBe(403);
  });

  it('a Apple com o nome posto pelo updateProfile dentro da espera: o perfil nasce com ele e o @ dele', async () => {
    // Aquece o gatilho, como no cadastro sem nome acima: com o worker frio,
    // ele já leria a conta com o nome, e a espera não seria provada.
    const warm = await auth.createUser({ email: newEmail(), displayName: 'Bruna Andrade' });
    await profileOf(warm.uid);

    // O app guarda o nome da Apple, entra e grava o nome na conta (o
    // updateProfile do SDK JS: o accounts:update com o token do fã). Aos 2,5 s,
    // o nome cai entre as releituras da espera (a conta do teste acima).
    const signed = await signInWithIdp('apple.com', appleClaims('larissa.moura@icloud.com'), {
      nonce: NONCE,
    });
    await sleep(2_500);
    const updated = await authApi('accounts:update', {
      idToken: signed.idToken,
      displayName: 'Larissa Moura',
      returnSecureToken: true,
    });
    expect(updated.error).toBeUndefined();

    const profile = await profileOf(signed.localId!);
    expect(profile).toMatchObject({ displayName: 'Larissa Moura', username: 'larissamou' });
    expect(await reservationsOf(signed.localId!)).toEqual(['larissamou']);
  });

  it.each([
    {
      label: 'o Google com @gmail.com',
      providerId: 'google.com' as const,
      claims: (email: string) => googleClaims(email, 'Bruna Google'),
    },
    {
      label: 'a Apple',
      providerId: 'apple.com' as const,
      claims: (email: string) => appleClaims(email),
    },
  ])(
    'a conta de e-mail e senha seguida de $label no mesmo e-mail: a mesma conta e o mesmo perfil, sem a senha',
    async ({ providerId, claims: claimsFor }) => {
      const fan = await signUpFan(db, 'Bruna Andrade', 'bruna.andrade@gmail.com');
      const before = await db.doc(`users/${fan.uid}`).get();
      expect(before.data()).toMatchObject({ displayName: 'Bruna Andrade', username: 'brunaand' });
      const validBefore = validAfterOf(await auth.getUser(fan.uid));
      // O validSince conta em segundos: a sobrescrita no segundo seguinte ao cadastro.
      await sleep(1_100);

      const claims = claimsFor(fan.email);
      const signed = await signInWithIdp(
        providerId,
        claims,
        providerId === 'apple.com' ? { nonce: NONCE } : {},
      );
      expect(signed.localId).toBe(fan.uid);
      expect(signed.isNewUser).toBeFalsy();
      expect(await sessionProviderOf(signed.idToken)).toBe(providerId);

      // A senha sai (o hasPassword do app vira falso), e o e-mail fica confirmado.
      const record = await auth.getUser(fan.uid);
      expect(record.providerData.map((info) => info.providerId)).toEqual([providerId]);
      expect(record.emailVerified).toBe(true);
      const withOldPassword = await authApi('accounts:signInWithPassword', {
        email: fan.email,
        password: fan.password,
        returnSecureToken: true,
      });
      expect(withOldPassword.error?.message).toMatch(/^INVALID_(PASSWORD|LOGIN_CREDENTIALS)/);
      // O nome e a foto do Auth passam a ser os do provedor: a Apple, sem nome, apaga o do cadastro.
      expect(record.displayName).toBe(claims.name);
      expect(record.photoURL).toBe(claims.picture);

      // Os outros aparelhos saem: o validSince andou, e o token de antes é recusado.
      expect(validAfterOf(record)).toBeGreaterThan(validBefore);
      const lookup = await authApi('accounts:lookup', { idToken: fan.token });
      expect(lookup.error?.message).toMatch(/^TOKEN_EXPIRED/);

      // Nenhum gatilho dispara: o perfil e o @ ficam como estavam.
      await sleep(2_000);
      const after = await db.doc(`users/${fan.uid}`).get();
      expect(after.updateTime!.isEqual(before.updateTime!)).toBe(true);
      expect(await reservationsOf(fan.uid)).toEqual(['brunaand']);
    },
  );

  it('a Apple e o Google no mesmo e-mail ficam na mesma conta, nas duas ordens, e o token diz o provedor da sessão', async () => {
    // A Apple primeiro: a conta nasce sem nome, e o Google entra nela sem erro.
    const liaApple = appleClaims('lia.prado@gmail.com', '001111.0a0a0a0a.0001');
    const liaGoogle = googleClaims('lia.prado@gmail.com', 'Lia Prado', {
      sub: '100000000000000000001',
    });
    const first = await signInWithIdp('apple.com', liaApple, { nonce: NONCE });
    const lia = first.localId!;
    const liaProfile = await profileOf(lia);
    expect(liaProfile.displayName).toBeNull();

    const viaGoogle = await signInWithIdp('google.com', liaGoogle);
    expect(viaGoogle.localId).toBe(lia);
    expect(viaGoogle.isNewUser).toBeFalsy();
    expect(await providerIdsOf(lia)).toEqual(['apple.com', 'google.com']);
    // A conta tem os dois, e o token diz por qual a sessão entrou.
    expect(await sessionProviderOf(viaGoogle.idToken)).toBe('google.com');
    const viaApple = await signInWithIdp('apple.com', liaApple, { nonce: NONCE });
    expect(viaApple.localId).toBe(lia);
    expect(await sessionProviderOf(viaApple.idToken)).toBe('apple.com');
    expect(await providerIdsOf(lia)).toEqual(['apple.com', 'google.com']);
    // O nome do Google fica no Auth, e o perfil, que nasceu sem nome, não muda.
    expect((await auth.getUser(lia)).displayName).toBe('Lia Prado');
    expect((await db.doc(`users/${lia}`).get()).data()).toMatchObject({
      displayName: null,
      username: liaProfile.username,
    });

    // O Google primeiro: a Apple entra na conta dele sem erro.
    const camilaGoogle = googleClaims('camila.prado@gmail.com', 'Camila Ribeiro', {
      sub: '100000000000000000002',
    });
    const camilaApple = appleClaims('camila.prado@gmail.com', '002222.0b0b0b0b.0002');
    const firstCamila = await signInWithIdp('google.com', camilaGoogle);
    const camila = firstCamila.localId!;
    const camilaProfile = await profileOf(camila);
    const camilaViaApple = await signInWithIdp('apple.com', camilaApple, { nonce: NONCE });
    expect(camilaViaApple.localId).toBe(camila);
    expect(camilaViaApple.isNewUser).toBeFalsy();
    expect(await sessionProviderOf(camilaViaApple.idToken)).toBe('apple.com');
    expect(await providerIdsOf(camila)).toEqual(['apple.com', 'google.com']);
    // A Apple, sem nome, apaga o nome do Auth; o perfil fica com o do Google.
    expect((await auth.getUser(camila)).displayName).toBeUndefined();
    expect((await db.doc(`users/${camila}`).get()).data()).toMatchObject({
      displayName: 'Camila Ribeiro',
      username: camilaProfile.username,
    });
  });

  it('o Google fora do Gmail seguido da Apple no mesmo e-mail: a mesma conta, confirmada pela Apple', async () => {
    const email = 'camila@empresa.com.br';
    const outsideGmail = googleClaims(email, 'Camila Ribeiro', { verified: false });
    const first = await signInWithIdp('google.com', outsideGmail);
    expect(first.isNewUser).toBe(true);
    const uid = first.localId!;
    const profile = await profileOf(uid);
    expect((await auth.getUser(uid)).emailVerified).toBe(false);

    // A Apple, confiável, entra na conta do Google não confiável: o mesmo uid e
    // os mesmos dados, com o e-mail confirmado. Em produção, ela também tira o
    // Google da conta (a doc do Firebase, 33.3); o emulador 15.32.0 calcula a
    // remoção e não a aplica, e o Google fica (33.18, etapa 2). A volta do
    // Google, depois de tirado, é o teste seguinte, a partir da conta só com a Apple.
    const viaApple = await signInWithIdp('apple.com', appleClaims(email), { nonce: NONCE });
    expect(viaApple.localId).toBe(uid);
    expect(viaApple.isNewUser).toBeFalsy();
    expect(await sessionProviderOf(viaApple.idToken)).toBe('apple.com');
    const record = await auth.getUser(uid);
    expect(record.emailVerified).toBe(true);
    expect(record.providerData.find((info) => info.providerId === 'apple.com')?.uid).toBe(
      APPLE_SUB,
    );
    expect((await db.doc(`users/${uid}`).get()).data()).toMatchObject({
      displayName: 'Camila Ribeiro',
      username: profile.username,
    });
  });

  it('a conta só com a Apple e o Google fora do Gmail no mesmo e-mail: o needConfirmation, e a volta pelo Esqueci minha senha e pelo ligar (pergunta 4)', async () => {
    // A conta como a sobrescrita deixa em produção: só a Apple, com o e-mail de verdade.
    const email = 'camila@empresa.com.br';
    const first = await signInWithIdp('apple.com', appleClaims(email), { nonce: NONCE });
    const uid = first.localId!;
    const profile = await profileOf(uid);

    // O Google: o needConfirmation, que o SDK JS lança como
    // auth/account-exists-with-different-credential, sem sessão. O e-mail vem
    // na resposta do emulador (o customData.email do erro).
    const outsideGmail = googleClaims(email, 'Camila Ribeiro', { verified: false });
    const refused = await signInWithIdp('google.com', outsideGmail);
    expect(refused.needConfirmation).toBe(true);
    expect(refused.email).toBe(email);
    expect(refused.idToken).toBeUndefined();
    expect(await providerIdsOf(uid)).toEqual(['apple.com']);

    // O "Esqueci minha senha" cria a senha na mesma conta...
    await resetPasswordByEmail(email, 'senha-nova-1');
    const withPassword = await authApi('accounts:signInWithPassword', {
      email,
      password: 'senha-nova-1',
      returnSecureToken: true,
    });
    expect(withPassword.localId).toBe(uid);
    expect(await sessionProviderOf(withPassword.idToken)).toBe('password');
    // ...e o modo "ligar" liga o Google com a credencial dele (o linkWithCredential).
    const linked = await signInWithIdp('google.com', outsideGmail, {
      idToken: withPassword.idToken,
    });
    expect(linked.localId).toBe(uid);
    expect(linked.isNewUser).toBeFalsy();
    // No emulador, o link do e-mail tira os outros provedores: a Apple sai no
    // resetPassword e volta sozinha na entrada seguinte (a conta ficou confirmada).
    expect(await providerIdsOf(uid)).toEqual(['google.com', 'password']);
    const appleBack = await signInWithIdp('apple.com', appleClaims(email), { nonce: NONCE });
    expect(appleBack.localId).toBe(uid);
    expect(await providerIdsOf(uid)).toEqual(['apple.com', 'google.com', 'password']);

    // O Google sozinho entra na mesma conta, e o perfil é o do começo.
    const googleBack = await signInWithIdp('google.com', outsideGmail);
    expect(googleBack.localId).toBe(uid);
    expect(await sessionProviderOf(googleBack.idToken)).toBe('google.com');
    expect((await db.doc(`users/${uid}`).get()).data()).toMatchObject({
      displayName: null,
      username: profile.username,
    });
  });

  it('a conta com senha e o Google fora do Gmail no mesmo e-mail: o needConfirmation, e o ligar depois da senha', async () => {
    const fan = await signUpFan(db, 'Bruna Andrade', 'bruna@empresa.com.br');
    const outsideGmail = googleClaims(fan.email, 'Bruna Andrade', { verified: false });

    const refused = await signInWithIdp('google.com', outsideGmail);
    expect(refused.needConfirmation).toBe(true);
    expect(refused.email).toBe(fan.email);
    expect(refused.idToken).toBeUndefined();
    expect(await providerIdsOf(fan.uid)).toEqual(['password']);

    // O modo "ligar": o fã entra com a senha, e o app liga a credencial do Google.
    const linked = await signInWithIdp('google.com', outsideGmail, {
      idToken: await signIn(fan.email, fan.password),
    });
    expect(linked.localId).toBe(fan.uid);
    expect(linked.isNewUser).toBeFalsy();
    expect(await providerIdsOf(fan.uid)).toEqual(['google.com', 'password']);

    // Depois, o Google sozinho entra na mesma conta, e a senha continua.
    const viaGoogle = await signInWithIdp('google.com', outsideGmail);
    expect(viaGoogle.localId).toBe(fan.uid);
    expect(await signIn(fan.email, fan.password)).toBeTruthy();
  });

  it('o Esqueci minha senha numa conta só do Google cria a senha na mesma conta', async () => {
    const email = 'bruna.andrade@gmail.com';
    const claims = googleClaims(email, 'Bruna Andrade');
    const first = await signInWithIdp('google.com', claims);
    const uid = first.localId!;
    const profile = await profileOf(uid);

    await resetPasswordByEmail(email, 'senha-nova-1');
    const withPassword = await authApi('accounts:signInWithPassword', {
      email,
      password: 'senha-nova-1',
      returnSecureToken: true,
    });
    expect(withPassword.localId).toBe(uid);
    expect(await sessionProviderOf(withPassword.idToken)).toBe('password');
    // No emulador, o link do e-mail tira o Google: só a senha fica...
    expect(await providerIdsOf(uid)).toEqual(['password']);
    // ...e o Google volta na entrada seguinte, sem erro e na mesma conta.
    const back = await signInWithIdp('google.com', claims);
    expect(back.localId).toBe(uid);
    expect(back.isNewUser).toBeFalsy();
    expect(await providerIdsOf(uid)).toEqual(['google.com', 'password']);
    expect((await db.doc(`users/${uid}`).get()).data()).toMatchObject({
      displayName: 'Bruna Andrade',
      username: profile.username,
    });
  });
});
