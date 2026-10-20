import { JOIN_CENTRAL_POINTS } from '@/domains/artists/fixtures';
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
      expect.objectContaining({ id: FOLLOWED_CLUB_ID, featured: true, isFollowing: true }),
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

  it('a gestora bloqueada: a página some, a linha fica sem nome e a Início sem as publicações', () => {
    fixtureBlocks.add('fa-rank-01');
    expect(errorOf(() => fanClubFixture.page(FOLLOWED_CLUB_ID))).toMatchObject({ status: 404 });
    expect(fanClubFixture.follows().items).toEqual([
      expect.objectContaining({ id: FOLLOWED_CLUB_ID, name: null, owner: null, available: false }),
    ]);
    expect(fanClubFixture.feed(null).items).toEqual([]);
    expect(fanClubFixture.artistClubs('nenho', null).items).toEqual([]);
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

describe('o fim da sessão', () => {
  it('volta ao retrato do seed (resetFixtureSession)', () => {
    fanClubFixture.follow(OTHER_CLUB_ID, key());
    fanClubFixture.unfollow(FOLLOWED_CLUB_ID, key());
    fanClubFixture.removePost('fcp-netto-faixa', key());
    resetFixtureSession();
    expect(fanClubFixture.follows().items.map((item) => item.id)).toEqual([FOLLOWED_CLUB_ID]);
    expect(fanClubFixture.mine().club).toMatchObject({ pendingPosts: 1, postCount: 2 });
    expect(fixtureMembership.isMember('rocksalles')).toBe(false);
  });
});
