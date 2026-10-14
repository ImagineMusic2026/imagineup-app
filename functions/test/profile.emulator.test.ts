import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { setTimeout as sleep } from 'node:timers/promises';
import { beforeAll, describe, expect, it } from 'vitest';

import { FILTERED_NAME, isBlockedText } from '../src/content-filter';
import { fanSearchKeys } from '../src/fan-profile';
import { handleUserCreated, NAME_WAIT_MS, type FindUser } from '../src/handlers';
import { dayKey } from '../src/points';
import { createProfile, deleteUserData } from '../src/store';
import { barredWordOf, readLegibleList, warnWithoutList } from './content-filter-list';
import { useCleanEmulators } from './support';

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
