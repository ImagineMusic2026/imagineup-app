import { followFixture, JOIN_CENTRAL_POINTS } from '@/domains/artists/fixtures';
import {
  fixtureBlocks,
  fixtureMembership,
  fixtureWallet,
  resetFixtureSession,
  setFixtureNow,
} from '@/services/fixtures';

import {
  FIXTURE_FAN_ID,
  FIXTURE_RULES_VERSION,
  FOLLOWED_CLUB_ID,
  fanClubFixture,
  OTHER_CLUB_ID,
  OWN_CLUB_ID,
} from '../fixtures';
import type { FanClubApplicationBody } from '../types';

// O fã-clube nas builds sem API (34.9 e 34.12): o retrato do seed com a
// Camila como a fã logada, as recusas do servidor e a regra de coerência da
// seção 13 no seguir que faz a entrada.

// A carteira (o `earnFixturePoints`) lê a fonte na hora: cada teste escolhe.
let mockWalletSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/data-source', () => ({
  sourceOf: (domain: string) => (domain === 'wallet' ? mockWalletSource : 'fixtures'),
  usesFixtures: () => true,
}));

const NOW = new Date(2026, 9, 19, 12, 0);
const HOUR = 60 * 60_000;

const BODY: FanClubApplicationBody = {
  artistId: 'nenho',
  name: 'Nenho no Coração',
  instagram: 'camila.teste.up',
  tiktok: null,
  whatsapp: '(75) 99123-4567',
  pitch: 'Divulgo o Nenho nos stories e no grupo dos fãs de Irará.',
  adult: true,
  rulesVersion: FIXTURE_RULES_VERSION,
};

/** O erro que a chamada lança, com o status, o código e os detalhes da API. */
function errorOf(call: () => unknown) {
  try {
    call();
  } catch (error) {
    const { status, code, details } = error as {
      status: number;
      code: string;
      details: unknown;
    };
    return { status, code, details };
  }
  throw new Error('a chamada não lançou');
}

let keys = 0;
const key = () => `chave-${(keys += 1)}`;

beforeEach(() => {
  mockWalletSource = 'fixtures';
  setFixtureNow(NOW);
});

afterEach(() => {
  resetFixtureSession();
  setFixtureNow(null);
});

describe('o retrato do seed', () => {
  it('a Camila é a gestora aprovada do Netto de Coração, com o programa aberto', () => {
    const mine = fanClubFixture.mine();
    expect(mine).toMatchObject({
      open: true,
      rulesUrl: null,
      rulesVersion: 'termos-2026-10',
      application: {
        status: 'approved',
        artistId: 'nettobrito',
        round: 1,
        canApply: false,
        rejectReason: null,
        canReapplyAt: null,
      },
      club: {
        id: OWN_CLUB_ID,
        name: 'Netto de Coração',
        status: 'active',
        postCount: 2,
        pendingPosts: 1,
        photosAllowed: true,
        featuredUntil: null,
        available: true,
        unavailableReason: null,
        rulesOutdated: false,
      },
    });
    expect(mine.notice).toContain('a critério da equipe');
    expect(mine.club?.lastReward).toEqual({
      at: new Date(NOW.getTime() - 48 * HOUR).toISOString(),
      points: 200,
      prize: true,
    });
    expect(mine.application?.history).toEqual([
      expect.objectContaining({ round: 1, decision: 'approved', reason: null }),
    ]);
  });

  it('os números somam os dois seguidores, o link e as duas entradas trazidas', () => {
    expect(fanClubFixture.numbers()).toEqual({
      followers: 2,
      followers30d: 2,
      links: 1,
      visits: 0,
      signups: 0,
      joins: 2,
      // A taxa de 30 dias (37.11): as 3 reações e os 3 comentários da Thalita e
      // do Davi sobre os 2 seguidores; a reação e a resposta da gestora não contam.
      engagement: { reactions30d: 3, comments30d: 3, rate30d: 300 },
    });
  });

  it('"Minhas publicações": a em análise, da mais nova, sem a foto', () => {
    const page = fanClubFixture.myPosts(null);
    expect(page.items.map((post) => post.status)).toEqual(['pending', 'published', 'published']);
    expect(page.items.every((post) => post.photo === null && post.clubId === OWN_CLUB_ID)).toBe(
      true,
    );
    expect(page.nextCursor).toBeNull();
  });

  it('a candidatura lista as centrais da Camila; o Nenho, só com texto', () => {
    expect(fanClubFixture.artists().items).toEqual([
      expect.objectContaining({ artistId: 'nettobrito', photosAllowed: true }),
      expect.objectContaining({ artistId: 'nenho', photosAllowed: false }),
      expect.objectContaining({ artistId: 'juninhomoraes', photosAllowed: true }),
    ]);
    // O nome curto do protótipo, como o seed das centrais.
    expect(fanClubFixture.artists().items[2]?.shortName).toBe('Juninho M.');
  });

  it('a página do próprio fã-clube diz que é dela; a do seguido, que ela segue', () => {
    expect(fanClubFixture.page(OWN_CLUB_ID)).toMatchObject({
      isOwner: true,
      isMember: true,
      isFollowing: false,
      followerCount: 2,
      postCount: 2,
      owner: { uid: FIXTURE_FAN_ID, username: 'camilarib' },
    });
    expect(fanClubFixture.page(FOLLOWED_CLUB_ID)).toMatchObject({
      isOwner: false,
      isFollowing: true,
      featured: true,
      followerCount: 42,
    });
    expect(fanClubFixture.page(OTHER_CLUB_ID)).toMatchObject({
      isMember: false,
      isFollowing: false,
    });
  });

  it('as publicações no ar da página, da mais nova; o fã-clube que não aparece é 404', () => {
    expect(fanClubFixture.clubPosts(OWN_CLUB_ID, null).items.map((post) => post.id)).toEqual([
      'fcp-netto-clipe',
      'fcp-netto-ensaio',
    ]);
    expect(errorOf(() => fanClubFixture.clubPosts('nao-existe', null))).toMatchObject({
      status: 404,
      code: 'fan_club_not_found',
    });
  });

  it('"Fã-clubes que sigo" e "Dos seus fã-clubes" começam com o fã-clube do Nenho', () => {
    expect(fanClubFixture.follows().items).toEqual([
      expect.objectContaining({ id: FOLLOWED_CLUB_ID, available: true, name: 'Nenho Sempre' }),
    ]);
    const feed = fanClubFixture.feed(null);
    expect(feed.items.map((post) => post.id)).toEqual(['fcp-nenho-feira', 'fcp-nenho-musica']);
    expect(feed.items[0]).toMatchObject({
      clubName: 'Nenho Sempre',
      author: { uid: 'fa-rank-01' },
    });
  });

  it('a lista do artista: os destacados primeiro, com o seguir de quem pede', () => {
    expect(fanClubFixture.artistClubs('nenho', null).items).toEqual([
      expect.objectContaining({
        id: FOLLOWED_CLUB_ID,
        featured: true,
        isFollowing: true,
        followers: 42,
      }),
    ]);
    expect(fanClubFixture.artistClubs('juninhomoraes', null)).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});

describe('seguir e deixar de seguir', () => {
  it('fora da central, seguir faz a entrada junto e paga a entrada uma vez (carteira de exemplo)', () => {
    const before = fixtureWallet.get().balance;
    expect(fixtureMembership.isMember('rocksalles')).toBe(false);
    const first = key();
    expect(fanClubFixture.follow(OTHER_CLUB_ID, first)).toEqual({
      clubId: OTHER_CLUB_ID,
      following: true,
      joined: true,
      pointsAwarded: JOIN_CENTRAL_POINTS,
    });
    expect(fixtureWallet.get().balance).toBe(before + JOIN_CENTRAL_POINTS);
    expect(fixtureMembership.isMember('rocksalles')).toBe(true);
    expect(fanClubFixture.page(OTHER_CLUB_ID)).toMatchObject({ isFollowing: true, isMember: true });
    // A mesma chave devolve a resposta da primeira vez; outra chave, já seguindo, sem gravar.
    expect(fanClubFixture.follow(OTHER_CLUB_ID, first).joined).toBe(true);
    expect(fanClubFixture.follow(OTHER_CLUB_ID, key())).toEqual({
      clubId: OTHER_CLUB_ID,
      following: true,
      joined: false,
      pointsAwarded: 0,
    });
    expect(fixtureWallet.get().balance).toBe(before + JOIN_CENTRAL_POINTS);
    // A lista do artista mostra os seguidores da cópia da noite, que o seguir
    // de agora não muda; a página conta na hora, como o servidor.
    expect(fanClubFixture.artistClubs('rocksalles', null).items[0]).toMatchObject({
      followers: 12,
      isFollowing: true,
    });
    expect(fanClubFixture.page(OTHER_CLUB_ID).followerCount).toBe(13);
  });

  it('com a carteira na API, a entrada pelo seguir de exemplo não rende ponto (seção 13)', () => {
    mockWalletSource = 'api';
    const before = fixtureWallet.get().balance;
    expect(fanClubFixture.follow(OTHER_CLUB_ID, key())).toMatchObject({
      joined: true,
      pointsAwarded: 0,
    });
    expect(fixtureWallet.get().balance).toBe(before);
  });

  it('o próprio fã-clube é recusado; o que não existe é 404', () => {
    expect(errorOf(() => fanClubFixture.follow(OWN_CLUB_ID, key()))).toEqual({
      status: 409,
      code: 'fan_club_refused',
      details: { reason: 'own_fan_club' },
    });
    expect(errorOf(() => fanClubFixture.follow('nao-existe', key()))).toMatchObject({
      status: 404,
      code: 'fan_club_not_found',
    });
  });

  it('deixar de seguir tira da lista e da Início, nunca recusa e não sai da central', () => {
    expect(fanClubFixture.unfollow(FOLLOWED_CLUB_ID, key())).toEqual({
      clubId: FOLLOWED_CLUB_ID,
      following: false,
    });
    expect(fanClubFixture.follows().items).toEqual([]);
    expect(fanClubFixture.feed(null).items).toEqual([]);
    expect(fanClubFixture.page(FOLLOWED_CLUB_ID).followerCount).toBe(41);
    expect(fixtureMembership.isMember('nenho')).toBe(true);
    expect(fanClubFixture.unfollow('nao-existe', key())).toEqual({
      clubId: 'nao-existe',
      following: false,
    });
  });

  it('bloquear a gestora apaga o seguir (decisão 32): a página some, e desbloquear não devolve', () => {
    fixtureBlocks.add('fa-rank-01');
    expect(errorOf(() => fanClubFixture.page(FOLLOWED_CLUB_ID))).toMatchObject({ status: 404 });
    expect(fanClubFixture.follows().items).toEqual([]);
    expect(fanClubFixture.feed(null).items).toEqual([]);
    expect(fanClubFixture.artistClubs('nenho', null).items).toEqual([]);
    fixtureBlocks.remove('fa-rank-01');
    expect(fanClubFixture.page(FOLLOWED_CLUB_ID)).toMatchObject({
      isFollowing: false,
      followerCount: 41,
    });
    expect(fanClubFixture.follows().items).toEqual([]);
  });

  it('sair da central apaga o seguir dos fã-clubes do artista (decisão 27), e voltar não devolve', () => {
    followFixture.leave('juninhomoraes', key());
    expect(fanClubFixture.follows().items.map((item) => item.id)).toEqual([FOLLOWED_CLUB_ID]);
    followFixture.leave('nenho', key());
    expect(fanClubFixture.follows().items).toEqual([]);
    expect(fanClubFixture.feed(null).items).toEqual([]);
    expect(fanClubFixture.page(FOLLOWED_CLUB_ID)).toMatchObject({
      isFollowing: false,
      isMember: false,
      followerCount: 41,
    });
    followFixture.join('nenho', key());
    expect(fanClubFixture.follows().items).toEqual([]);
  });
});

describe('a candidatura', () => {
  it('com o fã-clube no ar, a nova candidatura é recusada com has_fan_club', () => {
    expect(errorOf(() => fanClubFixture.apply(BODY, key()))).toEqual({
      status: 409,
      code: 'fan_club_refused',
      details: { reason: 'has_fan_club' },
    });
  });

  it.each<[string, Partial<FanClubApplicationBody>, string, string]>([
    ['o nome curto', { name: 'Ne' }, 'name', 'format'],
    ['o nome com oficial', { name: 'Fã-clube Ofícial do Nenho' }, 'name', 'official'],
    ['o texto curto', { pitch: 'Divulgo.' }, 'pitch', 'format'],
    ['sem rede', { instagram: null, tiktok: '  ' }, 'socials', 'format'],
    ['o WhatsApp fixo', { whatsapp: '(75) 3221-4567' }, 'whatsapp', 'format'],
    ['a versão velha', { rulesVersion: 'termos-2026-09' }, 'rulesVersion', 'format'],
  ])('o campo fora da regra vem antes da recusa: %s', (_name, change, field, reason) => {
    expect(errorOf(() => fanClubFixture.apply({ ...BODY, ...change }, key()))).toEqual({
      status: 400,
      code: 'fan_club_invalid',
      details: { field, reason },
    });
  });

  it('fora da central do artista, not_member, depois da conferência dos campos', () => {
    expect(errorOf(() => fanClubFixture.apply({ ...BODY, artistId: 'rocksalles' }, key()))).toEqual(
      { status: 409, code: 'fan_club_refused', details: { reason: 'not_member' } },
    );
  });

  it('o novo aceite: a versão de agora responde o estado sem mudar; a velha é fan_club_invalid', () => {
    expect(fanClubFixture.acceptRules(FIXTURE_RULES_VERSION, key())).toEqual(fanClubFixture.mine());
    expect(fanClubFixture.mine().club?.rulesOutdated).toBe(false);
    expect(errorOf(() => fanClubFixture.acceptRules('termos-2026-09', key()))).toEqual({
      status: 400,
      code: 'fan_club_invalid',
      details: { field: 'rulesVersion', reason: 'format' },
    });
  });

  it('desistir sem candidatura pendente responde o estado de agora, sem gravar', () => {
    expect(fanClubFixture.withdraw(key())).toEqual(fanClubFixture.mine());
    expect(fanClubFixture.mine().application?.status).toBe('approved');
  });
});

describe('publicar, retirar e denunciar', () => {
  it('a publicação nasce em análise, até 3; a quarta é too_many_pending', () => {
    const first = fanClubFixture.createPost({ text: '  Ensaio aberto!  ', photo: false }, key());
    expect(first).toMatchObject({ status: 'pending', kind: 'text', text: 'Ensaio aberto!' });
    fanClubFixture.createPost({ text: 'Mais uma', photo: false }, key());
    expect(fanClubFixture.mine().club?.pendingPosts).toBe(3);
    expect(
      errorOf(() => fanClubFixture.createPost({ text: 'A quarta', photo: false }, key())),
    ).toEqual({ status: 409, code: 'fan_club_refused', details: { reason: 'too_many_pending' } });
  });

  it('com foto, sem a vaga é upload_missing; com a vaga, ela sai na publicação', () => {
    expect(
      errorOf(() => fanClubFixture.createPost({ text: 'Com foto', photo: true }, key())),
    ).toMatchObject({ details: { reason: 'upload_missing' } });
    const slot = fanClubFixture.openUpload(key());
    expect(slot.photoPath).toMatch(/^fanClubMedia\/me\/club-photo-[a-z0-9-]+\.jpg$/);
    expect(slot.thumbPath).toMatch(/^fanClubMedia\/me\/club-thumb-[a-z0-9-]+\.jpg$/);
    expect(Date.parse(slot.expiresAt) - NOW.getTime()).toBe(10 * 60_000);
    expect(fanClubFixture.createPost({ text: 'Com foto', photo: true }, key()).kind).toBe('photo');
    expect(
      errorOf(() => fanClubFixture.createPost({ text: 'De novo', photo: true }, key())),
    ).toMatchObject({ details: { reason: 'upload_missing' } });
  });

  it('o texto vazio é fan_club_invalid no campo text', () => {
    expect(errorOf(() => fanClubFixture.createPost({ text: '   ', photo: false }, key()))).toEqual({
      status: 400,
      code: 'fan_club_invalid',
      details: { field: 'text', reason: 'format' },
    });
  });

  it('fora da central, o fã-clube fica indisponível e o publicar recusa not_member', () => {
    fixtureMembership.leave('nettobrito');
    expect(fanClubFixture.mine().club).toMatchObject({
      available: false,
      unavailableReason: 'not_member',
    });
    expect(
      errorOf(() => fanClubFixture.createPost({ text: 'Oi', photo: false }, key())),
    ).toMatchObject({ details: { reason: 'not_member' } });
  });

  it('retirar a em análise e tirar do ar a publicada; de outra autora ou de novo, 404', () => {
    expect(fanClubFixture.removePost('fcp-netto-faixa', key()).status).toBe('withdrawn');
    expect(fanClubFixture.removePost('fcp-netto-clipe', key()).status).toBe('removed');
    expect(fanClubFixture.mine().club).toMatchObject({ postCount: 1, pendingPosts: 0 });
    expect(errorOf(() => fanClubFixture.removePost('fcp-netto-faixa', key()))).toMatchObject({
      status: 404,
      code: 'fan_club_post_not_found',
    });
    expect(errorOf(() => fanClubFixture.removePost('fcp-nenho-feira', key()))).toMatchObject({
      status: 404,
    });
  });

  it('a denúncia: uma por publicação; a própria é own_post; a que não está no ar, 404', () => {
    expect(fanClubFixture.report('fcp-nenho-feira', 'image_misuse', key())).toEqual({
      postId: 'fcp-nenho-feira',
      status: 'reported',
    });
    expect(fanClubFixture.report('fcp-nenho-feira', null, key()).status).toBe('already_reported');
    expect(errorOf(() => fanClubFixture.report('fcp-netto-clipe', 'spam', key()))).toEqual({
      status: 400,
      code: 'invalid_request',
      details: { reason: 'own_post' },
    });
    expect(errorOf(() => fanClubFixture.report('fcp-netto-faixa', 'spam', key()))).toMatchObject({
      status: 404,
      code: 'fan_club_post_not_found',
    });
  });
});

// --- A Fase 2 (seção 37, 37.9: as fixtures no espelho do servidor) ----------------------

/** A publicação no ar, pela página do fã-clube dela. */
const postOf = (clubId: string, postId: string) =>
  fanClubFixture.clubPosts(clubId, null).items.find((post) => post.id === postId);

const RECUSA_SEM_SEGUIR = {
  status: 409,
  code: 'fan_club_refused',
  details: { reason: 'not_following' },
};

describe('as reações (R1)', () => {
  it('cada publicação traz os totais, os por emoji, a reação da Camila e os comentários', () => {
    expect(postOf(OWN_CLUB_ID, 'fcp-netto-clipe')).toMatchObject({
      reactionCount: 2,
      reactionCounts: { heart: 1, fire: 0, laugh: 0, wow: 0, clap: 1 },
      myReaction: 'heart',
      commentCount: 1,
      mentions: [],
    });
    expect(postOf(OWN_CLUB_ID, 'fcp-netto-ensaio')).toMatchObject({
      reactionCount: 2,
      myReaction: null,
      commentCount: 3,
    });
    // O comentário da Camila oculto pela gestora não conta (37.2).
    expect(postOf(FOLLOWED_CLUB_ID, 'fcp-nenho-feira')).toMatchObject({
      reactionCount: 15,
      myReaction: 'fire',
      commentCount: 2,
    });
    // "Minhas publicações" também, sem a reação de quem pede.
    expect(fanClubFixture.myPosts(null).items[1]).toMatchObject({
      id: 'fcp-netto-clipe',
      reactionCount: 2,
      commentCount: 1,
    });
  });

  it('trocar de emoji mexe nos dois; a mesma reação responde os números; a mesma chave, a resposta guardada', () => {
    const swapped = fanClubFixture.react('fcp-nenho-feira', 'laugh', 'chave-troca');
    expect(swapped).toEqual({
      postId: 'fcp-nenho-feira',
      reaction: 'laugh',
      reactionCount: 15,
      reactionCounts: { heart: 7, fire: 4, laugh: 2, wow: 0, clap: 2 },
      completedMissions: [],
      levelUp: null,
      unlockedAchievements: [],
      missionsChanged: false,
    });
    expect(fanClubFixture.react('fcp-nenho-feira', 'laugh', key())).toEqual(swapped);
    // A chave de antes devolve a resposta dela, mesmo depois de tirar.
    expect(fanClubFixture.clearReaction('fcp-nenho-feira', key())).toMatchObject({
      reaction: null,
      reactionCount: 14,
      reactionCounts: { laugh: 1 },
    });
    expect(fanClubFixture.react('fcp-nenho-feira', 'laugh', 'chave-troca')).toEqual(swapped);
    expect(postOf(FOLLOWED_CLUB_ID, 'fcp-nenho-feira')).toMatchObject({
      myReaction: null,
      reactionCount: 14,
    });
  });

  it('no fã-clube que ela não segue, reagir é not_following; tirar nunca é recusado', () => {
    expect(errorOf(() => fanClubFixture.react('fcp-rock-encontro', 'heart', key()))).toEqual(
      RECUSA_SEM_SEGUIR,
    );
    expect(fanClubFixture.clearReaction('fcp-rock-encontro', key())).toMatchObject({
      reaction: null,
      reactionCount: 5,
    });
    // A publicação que não existe: os números zerados, sem recusa.
    expect(fanClubFixture.clearReaction('nao-existe', key())).toMatchObject({
      reactionCount: 0,
      reactionCounts: { heart: 0, fire: 0, laugh: 0, wow: 0, clap: 0 },
    });
  });

  it('a gestora reage na própria publicação, e a reação dela não entra na taxa', () => {
    fanClubFixture.react('fcp-netto-ensaio', 'clap', key());
    expect(postOf(OWN_CLUB_ID, 'fcp-netto-ensaio')).toMatchObject({
      myReaction: 'clap',
      reactionCount: 3,
    });
    expect(fanClubFixture.numbers().engagement).toEqual({
      reactions30d: 3,
      comments30d: 3,
      rate30d: 300,
    });
  });

  it('a tela da publicação traz o que a página pede; a que não está no ar é 404', () => {
    expect(fanClubFixture.post('fcp-nenho-feira')).toMatchObject({
      id: 'fcp-nenho-feira',
      isOwner: false,
      isFollowing: true,
      isMember: true,
      artistName: 'Nenho',
      myReaction: 'fire',
    });
    expect(fanClubFixture.post('fcp-rock-encontro')).toMatchObject({
      isFollowing: false,
      isMember: false,
    });
    expect(errorOf(() => fanClubFixture.post('fcp-netto-faixa'))).toMatchObject({
      status: 404,
      code: 'fan_club_post_not_found',
    });
  });
});

describe('os comentários', () => {
  it('a gestora vê os de cima do mais novo, a resposta dela com o @ da Thalita e a marca de gestora', () => {
    const page = fanClubFixture.comments('fcp-netto-ensaio', null, null);
    expect(page.items.map((comment) => comment.id)).toEqual([
      'fcc-netto-ensaio-davi',
      'fcc-netto-ensaio-thalita',
    ]);
    expect(page.items[1]).toMatchObject({ replyCount: 1, hiddenReplyCount: 0, isManager: false });
    // A gestora não recebe o `ownHidden`: os que ela ocultou vêm na própria lista.
    expect(page.ownHidden).toBeUndefined();
    const replies = fanClubFixture.comments('fcp-netto-ensaio', 'fcc-netto-ensaio-thalita', null);
    const reply = replies.items[0]!;
    expect(reply).toMatchObject({
      author: { uid: FIXTURE_FAN_ID },
      isManager: true,
      replyToId: 'fcc-netto-ensaio-thalita',
      mentions: [{ handle: 'thalitasan', kind: 'fan', id: 'fa-rank-01', start: 0, end: 11 }],
    });
    const mention = reply.mentions[0]!;
    expect(reply.text.slice(mention.start, mention.end)).toBe('@thalitasan');
  });

  it('no Nenho, o comentário da Camila oculto pela gestora sai da lista e vem no ownHidden, com o pedido de revisão', () => {
    const page = fanClubFixture.comments('fcp-nenho-feira', null, null);
    expect(page.items.map((comment) => comment.id)).toEqual([
      'fcc-nenho-feira-davi',
      'fcc-nenho-feira-thalita',
    ]);
    expect(page.items[1]).toMatchObject({ isManager: true, hidden: null, review: null });
    expect(page.items[0]).not.toHaveProperty('hiddenReplyCount');
    expect(page.ownHidden).toEqual([
      expect.objectContaining({ id: 'fcc-nenho-feira-camila', hidden: 'manager', review: null }),
    ]);

    expect(fanClubFixture.requestReview('fcc-nenho-feira-camila', key())).toEqual({
      commentId: 'fcc-nenho-feira-camila',
      status: 'requested',
    });
    expect(fanClubFixture.requestReview('fcc-nenho-feira-camila', key()).status).toBe(
      'already_requested',
    );
    expect(fanClubFixture.comments('fcp-nenho-feira', null, null).ownHidden?.[0]?.review).toBe(
      'requested',
    );
    // O pedido é só da autora e só do oculto pela gestora.
    expect(errorOf(() => fanClubFixture.requestReview('fcc-nenho-feira-davi', key()))).toEqual({
      status: 404,
      code: 'fan_club_comment_not_found',
      details: null,
    });
  });

  it('quem ela bloqueou sai da lista dos outros fã-clubes; o gestor no próprio vê todos', () => {
    fixtureBlocks.add('fa-rank-02');
    expect(
      fanClubFixture.comments('fcp-nenho-feira', null, null).items.map((comment) => comment.id),
    ).toEqual(['fcc-nenho-feira-thalita']);
    expect(
      fanClubFixture.comments('fcp-netto-ensaio', null, null).items.map((comment) => comment.id),
    ).toEqual(['fcc-netto-ensaio-davi', 'fcc-netto-ensaio-thalita']);
  });

  it('comentar soma no total, com as marcações resolvidas e 0 ponto; a resposta a uma resposta vai para o de cima', () => {
    const comment = fanClubFixture.addComment(
      'fcp-netto-ensaio',
      { text: '  @davilim e @Nenho, bora! @naoexiste  ', replyToId: 'fcc-netto-ensaio-camila' },
      key(),
    );
    expect(comment).toMatchObject({
      text: '@davilim e @Nenho, bora! @naoexiste',
      isManager: true,
      replyToId: 'fcc-netto-ensaio-thalita',
      mentions: [
        { handle: 'davilim', kind: 'fan', id: 'fa-rank-02', start: 0, end: 8 },
        { handle: 'Nenho', kind: 'artist', id: 'nenho', start: 11, end: 17 },
      ],
      completedMissions: [],
      missionsChanged: false,
    });
    expect(postOf(OWN_CLUB_ID, 'fcp-netto-ensaio')?.commentCount).toBe(4);
    expect(fanClubFixture.comments('fcp-netto-ensaio', null, null).items[1]?.replyCount).toBe(2);
  });

  it('o texto vazio é comment_invalid antes de ler; sem seguir, not_following', () => {
    expect(
      errorOf(() =>
        fanClubFixture.addComment('fcp-rock-encontro', { text: '   ', replyToId: null }, key()),
      ),
    ).toEqual({ status: 400, code: 'comment_invalid', details: { reason: 'empty' } });
    expect(
      errorOf(() =>
        fanClubFixture.addComment('fcp-rock-encontro', { text: 'Oi!', replyToId: null }, key()),
      ),
    ).toEqual(RECUSA_SEM_SEGUIR);
    // Responder ao comentário oculto: 404, sem dizer o estado.
    expect(
      errorOf(() =>
        fanClubFixture.addComment(
          'fcp-nenho-feira',
          { text: 'Eu também!', replyToId: 'fcc-nenho-feira-camila' },
          key(),
        ),
      ),
    ).toMatchObject({ status: 404, code: 'fan_club_comment_not_found' });
  });
});

describe('a moderação dos comentários', () => {
  it('a denúncia: uma por comentário; o próprio é own_comment; o oculto, 404', () => {
    expect(fanClubFixture.reportComment('fcc-nenho-feira-davi', 'spam', key())).toEqual({
      commentId: 'fcc-nenho-feira-davi',
      status: 'reported',
    });
    expect(fanClubFixture.reportComment('fcc-nenho-feira-davi', null, key()).status).toBe(
      'already_reported',
    );
    expect(
      errorOf(() => fanClubFixture.reportComment('fcc-netto-ensaio-camila', null, key())),
    ).toEqual({ status: 400, code: 'invalid_request', details: { reason: 'own_comment' } });
    expect(
      errorOf(() => fanClubFixture.reportComment('fcc-nenho-feira-camila', null, key())),
    ).toMatchObject({ status: 404, code: 'fan_club_comment_not_found' });
  });

  it('a gestora oculta e reexibe no próprio fã-clube, com os contadores', () => {
    expect(fanClubFixture.hideComment('fcc-netto-ensaio-thalita', key())).toEqual({
      commentId: 'fcc-netto-ensaio-thalita',
      hidden: true,
    });
    // O de cima leva a resposta junto da vista (1 + replyCount, 37.6).
    expect(postOf(OWN_CLUB_ID, 'fcp-netto-ensaio')?.commentCount).toBe(1);
    expect(fanClubFixture.comments('fcp-netto-ensaio', null, null).items[1]).toMatchObject({
      id: 'fcc-netto-ensaio-thalita',
      hidden: 'manager',
    });
    // Já oculto por ela: responde sem gravar.
    expect(fanClubFixture.hideComment('fcc-netto-ensaio-thalita', key()).hidden).toBe(true);
    expect(fanClubFixture.unhideComment('fcc-netto-ensaio-thalita', key())).toEqual({
      commentId: 'fcc-netto-ensaio-thalita',
      hidden: false,
    });
    expect(postOf(OWN_CLUB_ID, 'fcp-netto-ensaio')?.commentCount).toBe(3);
  });

  it('as recusas do ocultar no formato do servidor: own_comment, staff_decided e o de outro fã-clube', () => {
    expect(errorOf(() => fanClubFixture.hideComment('fcc-netto-ensaio-camila', key()))).toEqual({
      status: 400,
      code: 'invalid_request',
      details: { reason: 'own_comment' },
    });
    expect(errorOf(() => fanClubFixture.hideComment('fcc-netto-clipe-davi', key()))).toEqual({
      status: 409,
      code: 'fan_club_refused',
      details: { reason: 'staff_decided' },
    });
    expect(errorOf(() => fanClubFixture.hideComment('fcc-nenho-feira-davi', key()))).toMatchObject({
      status: 404,
      code: 'fan_club_comment_not_found',
    });
    // Reexibir só o que ela ocultou.
    expect(
      errorOf(() => fanClubFixture.unhideComment('fcc-netto-ensaio-davi', key())),
    ).toMatchObject({ status: 404, code: 'fan_club_comment_not_found' });
  });
});

describe('as sugestões do @ (37.7)', () => {
  it('a conversa: a gestora, o artista e quem comentou, sem a Camila e sem dizer quem segue', () => {
    expect(fanClubFixture.mentions(FOLLOWED_CLUB_ID, 'fcp-nenho-feira', null).items).toEqual([
      {
        kind: 'fan',
        id: 'fa-rank-01',
        username: 'thalitasan',
        name: 'Thalita Santos',
        photoURL: null,
        role: 'manager',
        inConversation: true,
      },
      expect.objectContaining({ kind: 'artist', id: 'nenho', role: 'artist' }),
      expect.objectContaining({ kind: 'fan', id: 'fa-rank-02', role: null, inConversation: true }),
    ]);
    // No próprio fã-clube, a gestora não sugere a si mesma.
    expect(
      fanClubFixture.mentions(OWN_CLUB_ID, 'fcp-netto-ensaio', null).items.map((item) => item.id),
    ).toEqual(['nettobrito', 'fa-rank-02', 'fa-rank-01']);
    // A nova publicação, sem a publicação: só o artista.
    expect(fanClubFixture.mentions(OWN_CLUB_ID, null, null).items.map((item) => item.id)).toEqual([
      'nettobrito',
    ]);
  });

  it('a busca acha só as centrais: os três fãs estão com o @ gerado', () => {
    expect(fanClubFixture.mentions(FOLLOWED_CLUB_ID, null, 'ne').items).toEqual([
      expect.objectContaining({ id: 'nenho', role: 'artist', inConversation: true }),
      expect.objectContaining({ id: 'nettobrito', role: null, inConversation: false }),
    ]);
    expect(fanClubFixture.mentions(FOLLOWED_CLUB_ID, null, 'thal').items).toEqual([]);
  });

  it('as recusas: o q fora do formato, sem seguir e a publicação de outro fã-clube', () => {
    expect(errorOf(() => fanClubFixture.mentions(FOLLOWED_CLUB_ID, null, 'N'))).toEqual({
      status: 400,
      code: 'invalid_request',
      details: { field: 'q' },
    });
    expect(errorOf(() => fanClubFixture.mentions(OTHER_CLUB_ID, null, null))).toEqual(
      RECUSA_SEM_SEGUIR,
    );
    expect(
      errorOf(() => fanClubFixture.mentions(FOLLOWED_CLUB_ID, 'fcp-netto-ensaio', null)),
    ).toMatchObject({ status: 404, code: 'fan_club_post_not_found' });
  });
});

describe('o aviso de membro no seguir (seção 37, "Estado")', () => {
  it('a versão do servidor segue; outra versão é 400 no campo, sem seguir', () => {
    expect(
      errorOf(() =>
        fanClubFixture.follow(OTHER_CLUB_ID, key(), { memberNoticeVersion: 'membros-velho' }),
      ),
    ).toEqual({ status: 400, code: 'invalid_request', details: { field: 'memberNoticeVersion' } });
    expect(fanClubFixture.page(OTHER_CLUB_ID).isFollowing).toBe(false);
    expect(
      fanClubFixture.follow(OTHER_CLUB_ID, key(), { memberNoticeVersion: 'membros-2026-10' }),
    ).toMatchObject({ following: true, joined: true });
  });
});

describe('o fim da sessão', () => {
  it('volta ao retrato do seed (resetFixtureSession)', () => {
    fanClubFixture.follow(OTHER_CLUB_ID, key());
    fanClubFixture.unfollow(FOLLOWED_CLUB_ID, key());
    fanClubFixture.removePost('fcp-netto-faixa', key());
    fanClubFixture.react('fcp-netto-ensaio', 'wow', key());
    fanClubFixture.addComment('fcp-netto-ensaio', { text: 'Oi!', replyToId: null }, key());
    fanClubFixture.hideComment('fcc-netto-ensaio-davi', key());
    resetFixtureSession();
    expect(fanClubFixture.follows().items.map((item) => item.id)).toEqual([FOLLOWED_CLUB_ID]);
    expect(fanClubFixture.mine().club).toMatchObject({ pendingPosts: 1, postCount: 2 });
    expect(fixtureMembership.isMember('rocksalles')).toBe(false);
    expect(postOf(OWN_CLUB_ID, 'fcp-netto-ensaio')).toMatchObject({
      myReaction: null,
      reactionCount: 2,
      commentCount: 3,
    });
  });
});
