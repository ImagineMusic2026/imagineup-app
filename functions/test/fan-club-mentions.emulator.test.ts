import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { isBlockedText } from '../src/content-filter';
import { dayKey } from '../src/day';
import { FAN_CLUB_RULES_VERSION, MENTION_CONVERSATION_COMMENTS } from '../src/fan-clubs';
import { runFanSuspension } from '../src/moderation';
import { staticConfigSource } from '../src/points';
import { mentionWordOf, readLegibleList, warnWithoutList } from './content-filter-list';
import {
  callable,
  central,
  localApi,
  seedMember,
  signUpFan,
  unique,
  useEmulators,
  type Fan,
  type LocalResult,
  type Member,
} from './support';

/**
 * As menções do fã-clube, a etapa 2 de 37.13 (docs/arquitetura-api.md, seção
 * 37, 37.3 e 37.7): as marcações resolvidas no envio do comentário e da
 * publicação do gestor (o fã, a central no ar, o repetido, o maiúsculo e as
 * posições em UTF-16; o @ que não existe e a central em rascunho como texto);
 * a resposta com o @ de quem foi respondido; a marcação que segue a pessoa
 * depois da troca do @; o filtro com o "@" tirado só dos resolvidos (a
 * marcação legítima que passa e o @ não resolvido barrado na transação, sem
 * chave e sem teto, com a lista legível fora do repositório); e a rota das
 * sugestões: a conversa (com o suspenso e com quem bloqueou quem pede, sem
 * quem ele bloqueou e sem quem só segue; a resposta embaixo de um comentário
 * de cima visível, também do que ficou fora dos 30 últimos), a busca pelo
 * começo do @ (sem a conta privada, a suspensa, a de quem bloqueou quem pede,
 * a que ele bloqueou e o fã do @ gerado, sem nunca buscar pelo nome) e as
 * recusas da rota (o 404 da publicação de outro fã-clube e da fora do ar, o
 * 409 de quem não segue e o 400 do `q`, também no formato dos ids `__.*__`).
 */
const env = useEmulators('fa-clube-mencoes', ['api', 'createUserProfile', 'decideFanClub']);
const { db } = env;

const read = async (path: string) => (await db.doc(path).get()).data();

type Api = ReturnType<typeof localApi>;

/** O @ só barrado com o "@" na frente, da lista legível (nunca escrito no repositório). */
const MENTION_WORD = mentionWordOf(readLegibleList(), (text) => isBlockedText(text, 'comment'));
if (!MENTION_WORD) warnWithoutList('fan-club-mentions.emulator.test.ts (a marcação e o filtro)');

/** O handler no processo, com um relógio que o teste adianta (a ordem dos comentários). */
function clockApi() {
  const clock = { offset: 0 };
  const call = localApi(env, {
    now: () => Date.now() + clock.offset,
    config: staticConfigSource(),
  });
  return { clock, call };
}

async function ok(name: string, data: unknown, who: Pick<Member, 'token'>) {
  const { result, error } = await callable(env, name, data, who.token);
  if (error) throw new Error(`${name} falhou: ${error.status} ${error.details?.reason}`);
  return result;
}

/** Uma central no ar com a autorização de imagem (as caixas valem ligadas, decisão 9). */
async function openArtist(): Promise<string> {
  const artistId = await central(env);
  await db.doc(`artistPrivate/${artistId}`).set({ imageRightsConfirmed: true });
  return artistId;
}

/**
 * A reserva do @ da central, como o `createArtist` do painel grava (o
 * `central` dos testes grava só a central): sem ela, o @ da central fica texto.
 */
const reserveCentral = (artistId: string) =>
  db.doc(`usernames/${artistId}`).set({ artistId, createdAt: Timestamp.now() });

/** O @ de agora do fã, do perfil. */
const usernameOf = async (fan: Fan): Promise<string> =>
  (await read(`users/${fan.uid}`))?.username as string;

const join = (call: Api, fan: Fan, artistId: string) =>
  call('PUT', `/me/centrals/${artistId}`, { token: fan.token, key: unique('chave-entra-') });

const follow = (call: Api, fan: Fan, clubId: string) =>
  call('PUT', `/me/fan-club-follows/${clubId}`, { token: fan.token, key: unique('chave-segue-') });

const comment = (call: Api, fan: Fan, postId: string, text: string, replyToId?: string) =>
  call('POST', `/fan-club-posts/${postId}/comments`, {
    token: fan.token,
    key: unique('chave-comenta-'),
    body: replyToId === undefined ? { text } : { text, replyToId },
  });

const comments = (call: Api, fan: Fan, postId: string, query: Record<string, string> = {}) =>
  call('GET', `/fan-club-posts/${postId}/comments`, { token: fan.token, query });

/** A troca do @ pela rota do app: grava o `usernameChangedAt` (o @ escolhido). */
const changeUsername = (call: Api, fan: Fan, username: string) =>
  call('PUT', '/me/username', {
    token: fan.token,
    key: unique('chave-arroba-'),
    body: { username },
  });

const block = (call: Api, fan: Fan, fanId: string) =>
  call('PUT', `/me/blocks/${fanId}`, { token: fan.token, key: unique('chave-bloqueia-') });

const suggestions = (call: Api, fan: Fan, clubId: string, query: Record<string, string> = {}) =>
  call('GET', `/fan-clubs/${clubId}/mentions`, { token: fan.token, query });

type Owner = { fan: Fan; clubId: string; artistId: string };

/** O gestor de um fã-clube ativo de um artista novo: entra, se candidata e a equipe aprova. */
async function manager(call: Api, admin: Member, name = 'Camila Ribeiro'): Promise<Owner> {
  const artistId = await openArtist();
  const fan = await signUpFan(db, name);
  expect((await join(call, fan, artistId)).status).toBe(200);
  const applied = await call('POST', '/me/fan-club/application', {
    token: fan.token,
    key: unique('chave-candidata-'),
    body: {
      artistId,
      name: unique('Turma '),
      instagram: 'camila.teste.up',
      whatsapp: '(75) 99123-4567',
      pitch: 'Divulgo o artista nos stories e no grupo dos fãs da cidade.',
      adult: true,
      rulesVersion: FAN_CLUB_RULES_VERSION,
    },
  });
  expect(applied.status).toBe(200);
  await ok(
    'decideFanClub',
    { subject: 'application', id: fan.uid, decision: 'approve', expected: 1 },
    admin,
  );
  const clubId = (await read(`fanClubApplications/${fan.uid}`))?.clubId as string;
  expect(clubId).toEqual(expect.any(String));
  return { fan, clubId, artistId };
}

/** Publica (em análise) sem aprovar. Devolve a resposta. */
const submit = (call: Api, owner: Owner, text: string) =>
  call('POST', '/me/fan-club/posts', {
    token: owner.fan.token,
    key: unique('chave-publica-'),
    body: { text, photo: false },
  });

/** Uma publicação no ar do gestor: só texto, aprovada pela equipe. Devolve o id. */
async function publish(call: Api, admin: Member, owner: Owner, text: string): Promise<string> {
  const sent = await submit(call, owner, text);
  expect(sent.status).toBe(200);
  const postId = sent.body.id as string;
  await ok(
    'decideFanClub',
    { subject: 'post', id: postId, decision: 'approve', expected: 'pending' },
    admin,
  );
  return postId;
}

/** Um fã que segue o fã-clube (e entra junto na central). */
async function follower(call: Api, owner: Owner, name: string): Promise<Fan> {
  const fan = await signUpFan(db, name);
  expect((await follow(call, fan, owner.clubId)).status).toBe(200);
  return fan;
}

/** A marcação esperada de um @ no texto, pela ocorrência (a primeira a partir de `from`). */
function mentionAt(
  text: string,
  written: string,
  target: { kind: 'fan' | 'artist'; id: string },
  from = 0,
) {
  const start = text.indexOf(`@${written}`, from);
  expect(start, written).toBeGreaterThanOrEqual(0);
  return { handle: written, ...target, start, end: start + 1 + written.length };
}

const items = (sent: LocalResult) => sent.body.items as Record<string, unknown>[];

/** O contador do teto do dia na carteira. */
async function capCount(uid: string, key: string): Promise<number> {
  const wallet = await read(`wallets/${uid}`);
  return (wallet?.days?.[dayKey(Date.now())]?.count?.[key] as number | undefined) ?? 0;
}

const keysOf = async (uid: string) =>
  (await db.collection('idempotency').where('uid', '==', uid).get()).size;

describe('as marcações resolvidas no envio (37.7)', () => {
  it('o comentário guarda o fã, a central no ar, o repetido e o maiúsculo, com as posições em UTF-16; o @ que não existe e a central em rascunho ficam texto', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const owner = await manager(call, admin);
    await reserveCentral(owner.artistId);
    const draft = await central(env, { status: 'draft' });
    await reserveCentral(draft);
    const postId = await publish(call, admin, owner, 'Quem vem no sábado?');
    const bia = await follower(call, owner, 'Bia Santos');
    // Quem é marcado não precisa seguir nem ser da central (R3): qualquer conta de fã.
    const duda = await signUpFan(db, 'Duda Lima');
    const dudaAt = await usernameOf(duda);
    const upper = dudaAt.toUpperCase();
    const text =
      `\u{1F525}@${upper} vem com a gente! @${owner.artistId}, @${draft} ` +
      `e @naoexiste123. Bora, @${dudaAt}`;

    const sent = await comment(call, bia, postId, text);
    expect(sent.status).toBe(200);
    const mentions = [
      mentionAt(text, upper, { kind: 'fan', id: duda.uid }),
      mentionAt(text, owner.artistId, { kind: 'artist', id: owner.artistId }),
      mentionAt(text, dudaAt, { kind: 'fan', id: duda.uid }),
    ];
    // O emoji antes conta 2 unidades.
    expect(mentions[0]!.start).toBe(2);
    for (const mention of mentions) {
      expect(text.slice(mention.start, mention.end)).toBe(`@${mention.handle}`);
    }
    expect(sent.body).toMatchObject({ text, mentions });
    const commentId = sent.body.id as string;
    expect(await read(`fanClubComments/${commentId}`)).toMatchObject({
      text,
      mentions,
      mentionUids: [duda.uid],
    });
    // A lista devolve as marcações como foram gravadas.
    expect(items(await comments(call, bia, postId))).toEqual([
      expect.objectContaining({ id: commentId, mentions }),
    ]);
    // O comentário sem @ continua com as listas vazias.
    const plain = await comment(call, bia, postId, 'Sem marcação');
    expect(await read(`fanClubComments/${plain.body.id as string}`)).toMatchObject({
      mentions: [],
      mentionUids: [],
    });
  });

  it('a resposta começa pelo @ de quem foi respondido (R7) e marca a pessoa, também a do gestor', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem?');
    const bia = await follower(call, owner, 'Bia Santos');
    const biaAt = await usernameOf(bia);

    const top = (await comment(call, bia, postId, 'Eu vou!')).body.id as string;
    clock.offset += 1_000;
    const text = `@${biaAt} Te espero na frente do palco!`;
    const reply = await comment(call, owner.fan, postId, text, top);
    const mentions = [{ handle: biaAt, kind: 'fan', id: bia.uid, start: 0, end: biaAt.length + 1 }];
    expect(reply).toMatchObject({
      status: 200,
      body: { replyToId: top, isManager: true, text, mentions },
    });
    expect(await read(`fanClubComments/${reply.body.id as string}`)).toMatchObject({
      mentions,
      mentionUids: [bia.uid],
    });
    expect(items(await comments(call, bia, postId, { replyTo: top }))).toEqual([
      expect.objectContaining({ id: reply.body.id, mentions }),
    ]);
  });

  it('a marcação segue a pessoa: o @ trocado depois continua no mesmo link, e o @ que ficou livre marca quem o tomou', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await signUpFan(db, 'Duda Lima');
    const enzo = await signUpFan(db, 'Enzo Rocha');
    const old = await usernameOf(duda);

    const text = `Chama a @${old}!`;
    const before = await comment(call, bia, postId, text);
    const marked = [mentionAt(text, old, { kind: 'fan', id: duda.uid })];
    expect(before.body.mentions).toEqual(marked);

    // A Duda troca o @, e o Enzo toma na hora o que ficou livre (decisão 5 de 24.1).
    const fresh = unique('dudanova');
    expect((await changeUsername(call, duda, fresh)).status).toBe(200);
    expect((await changeUsername(call, enzo, old)).status).toBe(200);
    expect(await read(`usernames/${old}`)).toMatchObject({ uid: enzo.uid });

    // O comentário de antes continua com a Duda, com o @ escrito como estava.
    expect(items(await comments(call, bia, postId))).toEqual([
      expect.objectContaining({ id: before.body.id, text, mentions: marked }),
    ]);
    expect(await read(`fanClubComments/${before.body.id as string}`)).toMatchObject({
      mentionUids: [duda.uid],
    });
    // Os comentários novos seguem a reserva de agora.
    clock.offset += 1_000;
    const again = `@${old} e @${fresh}`;
    const after = await comment(call, bia, postId, again);
    expect(after.body.mentions).toEqual([
      mentionAt(again, old, { kind: 'fan', id: enzo.uid }),
      mentionAt(again, fresh, { kind: 'fan', id: duda.uid }),
    ]);
    expect(await read(`fanClubComments/${after.body.id as string}`)).toMatchObject({
      mentionUids: [enzo.uid, duda.uid],
    });
  });

  it('a publicação do gestor resolve as marcações no envio; "Minhas publicações", a página e a publicação as mostram', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const owner = await manager(call, admin);
    await reserveCentral(owner.artistId);
    const bia = await follower(call, owner, 'Bia Santos');
    const biaAt = await usernameOf(bia);
    const text = `Valeu, @${biaAt}! Nos vemos no show de @${owner.artistId}.`;

    const sent = await submit(call, owner, text);
    const mentions = [
      mentionAt(text, biaAt, { kind: 'fan', id: bia.uid }),
      mentionAt(text, owner.artistId, { kind: 'artist', id: owner.artistId }),
    ];
    expect(sent).toMatchObject({ status: 200, body: { status: 'pending', text, mentions } });
    const postId = sent.body.id as string;
    expect(await read(`fanClubPosts/${postId}`)).toMatchObject({
      text,
      mentions,
      mentionUids: [bia.uid],
    });
    await ok(
      'decideFanClub',
      { subject: 'post', id: postId, decision: 'approve', expected: 'pending' },
      admin,
    );
    expect(items(await call('GET', '/me/fan-club/posts', { token: owner.fan.token }))).toEqual([
      expect.objectContaining({ id: postId, status: 'published', mentions }),
    ]);
    expect(
      items(await call('GET', `/fan-clubs/${owner.clubId}/posts`, { token: bia.token })),
    ).toEqual([expect.objectContaining({ id: postId, mentions })]);
    expect(
      (await call('GET', `/fan-club-posts/${postId}`, { token: bia.token })).body,
    ).toMatchObject({ id: postId, mentions });
  });

  it.skipIf(!MENTION_WORD)(
    'o filtro: a marcação legítima passa, e o @ não resolvido continua barrado na transação, sem chave, sem teto e sem texto',
    async () => {
      // O @ só vive em memória: as conferências abaixo comparam códigos,
      // números e booleanos, e nenhuma mensagem de falha mostra o texto.
      const word = MENTION_WORD!;
      const admin = await seedMember(env, 'Admin da Equipe', 'admin');
      const { call } = clockApi();
      const owner = await manager(call, admin);
      const postId = await publish(call, admin, owner, 'Quem vem?');
      const bia = await follower(call, owner, 'Bia Santos');
      const duda = await signUpFan(db, 'Duda Lima');
      const text = `Que foto, @${word}!`;
      expect(isBlockedText(text, 'comment')).toBe(true);
      expect(isBlockedText(`Que foto, ${word}!`, 'comment')).toBe(false);
      expect(isBlockedText(text, 'fanClubPost')).toBe(true);
      expect(isBlockedText(`Que foto, ${word}!`, 'fanClubPost')).toBe(false);

      // Sem a reserva, o @ fica texto, e o "@" volta à conferência: o corpo
      // passa (o "@" tirado de todos) e a transação barra, sem gravar nada.
      const biaWallet = await read(`wallets/${bia.uid}`);
      const biaKeys = await keysOf(bia.uid);
      const refused = await comment(call, bia, postId, text);
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('comment_invalid');
      expect(refused.body.details).toEqual({ reason: 'not_allowed' });
      expect(
        (await db.collection('fanClubComments').where('postId', '==', postId).get()).size,
      ).toBe(0);
      expect(await keysOf(bia.uid)).toBe(biaKeys);
      expect(await capCount(bia.uid, 'fanclub_comment_sent')).toBe(0);
      expect(await read(`wallets/${bia.uid}`)).toEqual(biaWallet);
      expect(await read(`fanClubPosts/${postId}`)).toMatchObject({ commentCount: 0 });

      const ownerWallet = await read(`wallets/${owner.fan.uid}`);
      const ownerKeys = await keysOf(owner.fan.uid);
      const posts = async () =>
        (await db.collection('fanClubPosts').where('authorUid', '==', owner.fan.uid).get()).size;
      const postsBefore = await posts();
      const refusedPost = await submit(call, owner, text);
      expect(refusedPost.status).toBe(400);
      expect(refusedPost.body.code).toBe('fan_club_invalid');
      expect(refusedPost.body.details).toEqual({ field: 'text', reason: 'not_allowed' });
      expect(await posts()).toBe(postsBefore);
      expect(await keysOf(owner.fan.uid)).toBe(ownerKeys);
      expect(await read(`wallets/${owner.fan.uid}`)).toEqual(ownerWallet);

      // Com a reserva (a Duda com esse @), o @ é marcação, conferido como palavra: passa.
      await db.doc(`usernames/${word}`).set({ uid: duda.uid, createdAt: Timestamp.now() });
      const accepted = await comment(call, bia, postId, text);
      expect(accepted.status).toBe(200);
      expect(accepted.body.text === text).toBe(true);
      const marked = accepted.body.mentions as { id: string; start: number }[];
      expect(marked.map((mention) => [mention.id, mention.start])).toEqual([
        [duda.uid, text.indexOf('@')],
      ]);
      expect(await capCount(bia.uid, 'fanclub_comment_sent')).toBe(1);
      const acceptedPost = await submit(call, owner, text);
      expect(acceptedPost.status).toBe(200);
      expect((acceptedPost.body.mentions as { id: string }[]).map((mention) => mention.id)).toEqual(
        [duda.uid],
      );
    },
  );
});

describe('as sugestões do @ (37.3 e 37.7)', () => {
  it('a conversa: o gestor, o artista e quem comentou, com o suspenso e com quem bloqueou quem pede, sem quem ele bloqueou; quem só segue não aparece', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem?');
    const otherPost = await publish(call, admin, owner, 'E nessa?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const enzo = await follower(call, owner, 'Enzo Rocha');
    const gil = await follower(call, owner, 'Gil Souza');
    // Só segue, sem comentar: nunca aparece (R5).
    const leo = await follower(call, owner, 'Leo Alves');
    // Comenta só na outra publicação.
    const ana = await follower(call, owner, 'Ana Ferreira');

    for (const [fan, text] of [
      [gil, 'Eu vou!'],
      [enzo, 'Também vou!'],
      [duda, 'Bora!'],
    ] as const) {
      clock.offset += 1_000;
      expect((await comment(call, fan, postId, text)).status).toBe(200);
    }
    expect((await comment(call, ana, otherPost, 'Nessa eu vou')).status).toBe(200);
    // A Duda bloqueia a Bia; a Bia bloqueia o Gil; a equipe suspende o Enzo.
    expect((await block(call, duda, bia.uid)).status).toBe(200);
    expect((await block(call, bia, gil.uid)).status).toBe(200);
    await runFanSuspension(
      db,
      { uid: enzo.uid, suspended: true, reason: 'spam', note: null },
      { actor: { uid: admin.uid, name: 'Admin da Equipe' } },
    );

    const ownerAt = await usernameOf(owner.fan);
    const managerItem = {
      kind: 'fan',
      id: owner.fan.uid,
      username: ownerAt,
      name: 'Camila Ribeiro',
      photoURL: null,
      role: 'manager',
      inConversation: true,
    };
    const artistItem = {
      kind: 'artist',
      id: owner.artistId,
      username: owner.artistId,
      name: `Central ${owner.artistId}`,
      photoURL: null,
      role: 'artist',
      inConversation: true,
    };
    const fanItem = async (fan: Fan, name: string) => ({
      kind: 'fan',
      id: fan.uid,
      username: await usernameOf(fan),
      name,
      photoURL: null,
      role: null,
      inConversation: true,
    });

    // A Duda bloqueou a Bia e o Enzo está suspenso: os comentários deles estão
    // na tela da Bia, e tirá-los daqui contaria o bloqueio e a suspensão.
    const sent = await suggestions(call, bia, owner.clubId, { postId });
    expect(sent).toEqual({
      status: 200,
      body: {
        items: [
          managerItem,
          artistItem,
          await fanItem(duda, 'Duda Lima'),
          await fanItem(enzo, 'Enzo Rocha'),
        ],
      },
    });
    const json = JSON.stringify(sent.body);
    for (const absent of [bia.uid, gil.uid, leo.uid, ana.uid]) expect(json).not.toContain(absent);

    // Sem a publicação (a nova publicação do gestor, que ainda não tem id): o gestor e o artista.
    expect(await suggestions(call, bia, owner.clubId)).toEqual({
      status: 200,
      body: { items: [managerItem, artistItem] },
    });
    // O gestor não sugere a si mesmo, e no próprio fã-clube vê todos.
    expect(items(await suggestions(call, owner.fan, owner.clubId, { postId }))).toEqual([
      artistItem,
      await fanItem(duda, 'Duda Lima'),
      await fanItem(enzo, 'Enzo Rocha'),
      await fanItem(gil, 'Gil Souza'),
    ]);
    expect(items(await suggestions(call, owner.fan, owner.clubId))).toEqual([artistItem]);
  });

  it('a conversa com as respostas: a resposta conta embaixo de um comentário de cima visível, também do que ficou fora dos 30 últimos (lido no `getAll`)', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem?');
    const oldPost = await publish(call, admin, owner, 'Lembram desse show?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const gil = await follower(call, owner, 'Gil Souza');
    const leo = await follower(call, owner, 'Leo Alves');
    const rui = await follower(call, owner, 'Rui Costa');

    const head = [
      {
        kind: 'fan',
        id: owner.fan.uid,
        username: await usernameOf(owner.fan),
        name: 'Camila Ribeiro',
        photoURL: null,
        role: 'manager',
        inConversation: true,
      },
      {
        kind: 'artist',
        id: owner.artistId,
        username: owner.artistId,
        name: `Central ${owner.artistId}`,
        photoURL: null,
        role: 'artist',
        inConversation: true,
      },
    ];
    const fanItem = async (fan: Fan, name: string) => ({
      kind: 'fan',
      id: fan.uid,
      username: await usernameOf(fan),
      name,
      photoURL: null,
      role: null,
      inConversation: true,
    });

    // A resposta pela rota, embaixo do comentário do Gil: o Rui entra, antes do Gil.
    const gilSaid = await comment(call, gil, postId, 'Eu vou!');
    expect(gilSaid.status).toBe(200);
    clock.offset += 1_000;
    expect((await comment(call, rui, postId, 'Eu também!', gilSaid.body.id as string)).status).toBe(
      200,
    );
    expect(items(await suggestions(call, bia, owner.clubId, { postId }))).toEqual([
      ...head,
      await fanItem(rui, 'Rui Costa'),
      await fanItem(gil, 'Gil Souza'),
    ]);

    // O comentário de cima fora dos 30 últimos: o do Leo e a resposta do Rui,
    // com 29 comentários de cima da Duda no meio (gravados direto). A consulta
    // traz a resposta e não o comentário de cima, lido à parte no `getAll`.
    clock.offset += 1_000;
    const leoSaid = await comment(call, leo, oldPost, 'Eu fui!');
    expect(leoSaid.status).toBe(200);
    const leoId = leoSaid.body.id as string;
    clock.offset += 60_000;
    expect((await comment(call, rui, oldPost, 'Eu também!', leoId)).status).toBe(200);
    const leoAt = ((await read(`fanClubComments/${leoId}`))?.createdAt as Timestamp).toMillis();
    const dudaUsername = await usernameOf(duda);
    const batch = db.batch();
    for (let index = 1; index < MENTION_CONVERSATION_COMMENTS; index += 1) {
      batch.set(db.collection('fanClubComments').doc(), {
        clubId: owner.clubId,
        postId: oldPost,
        artistId: owner.artistId,
        authorUid: duda.uid,
        authorName: 'Duda Lima',
        authorUsername: dudaUsername,
        authorPhotoURL: null,
        text: `Bora ${index}!`,
        mentions: [],
        mentionUids: [],
        replyToId: null,
        replyCount: 0,
        managerHiddenReplyCount: 0,
        status: 'visible',
        hiddenAt: null,
        hiddenBy: null,
        restoredByStaffAt: null,
        reviewRequestedAt: null,
        reviewOutcome: null,
        // Entre o comentário do Leo e a resposta do Rui (60 s depois).
        createdAt: Timestamp.fromMillis(leoAt + index),
        schemaVersion: 1,
      });
    }
    await batch.commit();
    const sent = await suggestions(call, bia, owner.clubId, { postId: oldPost });
    expect(items(sent)).toEqual([
      ...head,
      await fanItem(rui, 'Rui Costa'),
      await fanItem(duda, 'Duda Lima'),
    ]);
    // O Leo não veio nos 30 últimos: o comentário dele só conta para a resposta.
    expect(JSON.stringify(sent.body)).not.toContain(leo.uid);

    // O comentário de cima oculto pelo gestor: a resposta embaixo dele sai da tela e daqui.
    await db.doc(`fanClubComments/${leoId}`).update({ status: 'manager_hidden' });
    expect(items(await suggestions(call, bia, owner.clubId, { postId: oldPost }))).toEqual([
      ...head,
      await fanItem(duda, 'Duda Lima'),
    ]);
  });

  it('a busca: só pelo começo do @, das centrais no ar e dos fãs que escolheram o @; a conta privada, a suspensa, a de quem bloqueou quem pede e a que ele bloqueou somem do mesmo jeito', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const owner = await manager(call, admin);
    const bia = await follower(call, owner, 'Bia Santos');
    const chosen = async (name: string, username: string): Promise<Fan> => {
      const fan = await signUpFan(db, name);
      expect((await changeUsername(call, fan, username)).status, username).toBe(200);
      return fan;
    };
    const ana = await chosen('Ana Ferreira', 'turmaana');
    const beto = await chosen('Beto Lima', 'turmabeto');
    const caio = await chosen('Caio Souza', 'turmacaio');
    const dani = await chosen('Dani Rocha', 'turmadani');
    const eva = await chosen('Eva Alves', 'turmaeva');
    // O @ gerado do nome ("Turma Fabiana" vira "turmafab"), nunca trocado: fora da busca.
    const fabi = await signUpFan(db, 'Turma Fabiana');
    expect(await usernameOf(fabi)).toMatch(/^turma/);
    // O nome começa pela busca, e o @ escolhido não: a busca nunca é pelo nome (R6).
    const gil = await chosen('Turma Gil', 'gilzinho');
    // Quem pede, com o @ que começa pela busca: fora.
    expect((await changeUsername(call, bia, 'turmabia')).status).toBe(200);
    // O gestor com o @ escolhido: na busca, com o papel.
    expect((await changeUsername(call, owner.fan, 'turmagestora')).status).toBe(200);
    // A central no ar e a em rascunho, com as reservas.
    const live = await central(env, {}, 'turmacentral');
    await reserveCentral(live);
    const draft = await central(env, { status: 'draft' }, 'turmarascunho');
    await reserveCentral(draft);

    await db.doc(`users/${beto.uid}`).update({ privateAccount: true });
    await runFanSuspension(
      db,
      { uid: caio.uid, suspended: true, reason: 'spam', note: null },
      { actor: { uid: admin.uid, name: 'Admin da Equipe' } },
    );
    expect((await block(call, dani, bia.uid)).status).toBe(200);
    expect((await block(call, bia, eva.uid)).status).toBe(200);

    const sent = await suggestions(call, bia, owner.clubId, { q: 'turma' });
    expect(sent).toEqual({
      status: 200,
      body: {
        items: [
          {
            kind: 'fan',
            id: ana.uid,
            username: 'turmaana',
            name: 'Ana Ferreira',
            photoURL: null,
            role: null,
            inConversation: false,
          },
          {
            kind: 'artist',
            id: live,
            username: live,
            name: `Central ${live}`,
            photoURL: null,
            role: null,
            inConversation: false,
          },
          {
            kind: 'fan',
            id: owner.fan.uid,
            username: 'turmagestora',
            name: 'Camila Ribeiro',
            photoURL: null,
            role: 'manager',
            inConversation: true,
          },
        ],
      },
    });
    const json = JSON.stringify(sent.body);
    for (const absent of [beto, caio, dani, eva, fabi, gil, bia]) {
      expect(json).not.toContain(absent.uid);
    }
    // O começo do @ mais longo estreita; o @ inteiro também acha.
    expect(items(await suggestions(call, bia, owner.clubId, { q: 'turmaa' }))).toEqual([
      expect.objectContaining({ id: ana.uid }),
    ]);
    expect(items(await suggestions(call, bia, owner.clubId, { q: 'turmaana' }))).toEqual([
      expect.objectContaining({ id: ana.uid }),
    ]);
    // O artista do fã-clube leva o papel.
    expect(items(await suggestions(call, bia, owner.clubId, { q: owner.artistId }))).toEqual([]);
    await reserveCentral(owner.artistId);
    expect(items(await suggestions(call, bia, owner.clubId, { q: owner.artistId }))).toEqual([
      expect.objectContaining({ kind: 'artist', id: owner.artistId, role: 'artist' }),
    ]);
    // As escondidas continuam marcáveis pelo @ digitado inteiro (R3).
    const postId = await publish(call, admin, owner, 'Quem vem?');
    const marked = await comment(call, bia, postId, '@turmabeto @turmacaio @turmadani');
    expect((marked.body.mentions as { id: string }[]).map((mention) => mention.id)).toEqual([
      beto.uid,
      caio.uid,
      dani.uid,
    ]);
  });

  it('a rota confere o fã-clube, a publicação e quem pede: o 404 da publicação de outro fã-clube e da fora do ar, o 409 de quem não segue e o 400 do `q`', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const owner = await manager(call, admin);
    const other = await manager(call, admin, 'Duda Lima');
    const postId = await publish(call, admin, owner, 'Quem vem?');
    const otherPost = await publish(call, admin, other, 'Do outro fã-clube');
    const pending = (await submit(call, owner, 'Em análise')).body.id as string;
    const removed = await publish(call, admin, owner, 'Vai sair do ar');
    expect(
      (
        await call('DELETE', `/me/fan-club/posts/${removed}`, {
          token: owner.fan.token,
          key: unique('chave-retira-'),
        })
      ).status,
    ).toBe(200);
    const bia = await follower(call, owner, 'Bia Santos');
    const visitor = await signUpFan(db, 'Enzo Rocha');
    const notFound = { status: 404, body: { code: 'fan_club_post_not_found' } };

    expect((await suggestions(call, bia, owner.clubId, { postId })).status).toBe(200);
    // A publicação de outro fã-clube, a em análise, a tirada do ar e a que não existe:
    // 404, sem ler os comentários.
    for (const id of [otherPost, pending, removed, 'naoexiste']) {
      expect(await suggestions(call, bia, owner.clubId, { postId: id }), id).toMatchObject(
        notFound,
      );
    }
    // Quem não segue e não é o gestor: 409, na conversa e na busca. A
    // publicação de outro fã-clube é conferida antes.
    const queries: Record<string, string>[] = [{}, { postId }, { q: 'bia' }];
    for (const query of queries) {
      expect(await suggestions(call, visitor, owner.clubId, query)).toMatchObject({
        status: 409,
        body: { code: 'fan_club_refused', details: { reason: 'not_following' } },
      });
    }
    expect(await suggestions(call, visitor, owner.clubId, { postId: otherPost })).toMatchObject(
      notFound,
    );
    // O gestor não segue o próprio fã-clube e pede do mesmo jeito.
    expect((await suggestions(call, owner.fan, owner.clubId, { postId })).status).toBe(200);
    // O `q` fora do formato e o `q` no formato dos ids que o Firestore
    // reserva (o cursor da busca): 400 sem ler.
    for (const q of ['b', '@bia', 'Bia', 'bia santos', '____', '__ab__']) {
      expect(await suggestions(call, bia, owner.clubId, { q }), q).toMatchObject({
        status: 400,
        body: { code: 'invalid_request', details: { field: 'q' } },
      });
    }
    // O fã-clube que quem pede não vê (o gestor bloqueado): 404 do fã-clube.
    expect((await block(call, visitor, owner.fan.uid)).status).toBe(200);
    expect(await suggestions(call, visitor, owner.clubId)).toMatchObject({
      status: 404,
      body: { code: 'fan_club_not_found' },
    });
    expect(await suggestions(call, bia, 'naoexiste')).toMatchObject({
      status: 404,
      body: { code: 'fan_club_not_found' },
    });
  });
});
