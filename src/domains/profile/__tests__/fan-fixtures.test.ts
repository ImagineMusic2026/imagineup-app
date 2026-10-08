import { buildArtistsFixture } from '@/domains/artists/fixtures';
import { buildCommentsPageFixture, buildPostsFixture } from '@/domains/posts/fixtures';
import { buildLeaderboardPageFixture, RANKING_SEED } from '@/domains/ranking/fixtures';
import type { RankingScope } from '@/domains/ranking';
import { ApiError } from '@/services/api/errors';
import { setFixtureNow } from '@/services/fixtures';
import { cleanMultiline, isVisibleMultiline } from '@/utils/visible-line';

import { BIO_MAX, BIO_MAX_LINES, normalizeSocialHandle, SOCIAL_NETWORKS } from '../details';
import {
  buildFanProfileFixture,
  COMMENT_AUTHOR_ALIASES,
  COMMENT_ONLY_AUTHORS,
  FAN_FIXTURE_DETAILS,
  fanProfileFixture,
  fixtureUsername,
} from '../fan-fixtures';

// Os comentários de exemplo entram pelo domínio de posts, que puxa as missões e o
// perfil (Firestore); nada aqui fala com eles.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn() } }));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'fixtures',
  usesFixtures: () => true,
}));

// Terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);

beforeEach(() => setFixtureNow(NOW));
afterEach(() => setFixtureNow(null));

/** Todas as linhas de um recorte do ranking de exemplo, página a página. */
function boardOf(scope: RankingScope): string[] {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const page = buildLeaderboardPageFixture(scope, cursor);
    ids.push(...page.items.map((entry) => entry.userId));
    cursor = page.nextCursor;
  } while (cursor !== null);
  return ids;
}

/** Todos os comentários de exemplo de um post, página a página. */
function commentsOf(postId: string) {
  const comments = [];
  let cursor: string | null = null;
  do {
    const page = buildCommentsPageFixture(NOW, postId, cursor);
    comments.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return comments;
}

const PUBLIC_KEYS = ['uid', 'displayName', 'username', 'photoURL', 'restricted', 'bio', 'socials'];

describe('perfil público de exemplo: coerência com o ranking e os comentários', () => {
  it('todo fã do ranking de exemplo (o geral e cada central, sem o "me") abre um perfil', () => {
    const scopes: RankingScope[] = [
      { kind: 'global' },
      ...buildArtistsFixture().map((artist): RankingScope => ({
        kind: 'artist',
        artistId: artist.id,
      })),
    ];
    const ids = new Set(scopes.flatMap(boardOf));
    expect(ids.has('me')).toBe(true);
    ids.delete('me');
    expect(ids.size).toBe(RANKING_SEED.length);
    for (const id of ids) {
      const profile = buildFanProfileFixture(id);
      const person = RANKING_SEED.find((seed) => seed.userId === id);
      expect({ id, name: profile.displayName }).toEqual({ id, name: person?.displayName });
      expect(profile.uid).toBe(id);
    }
  });

  it('todo autor de comentário de exemplo que não é artista abre um perfil; o artista dá 404', () => {
    const comments = buildPostsFixture(NOW).flatMap((post) => commentsOf(post.id));
    const authors = new Set(comments.filter((c) => !c.authorIsArtist).map((c) => c.authorId));
    expect(authors.size).toBeGreaterThan(10);
    for (const id of authors) {
      expect(buildFanProfileFixture(id).uid).toBe(id);
    }
    // Os que são gente do ranking abrem o perfil dela, com o nome do ranking.
    expect(buildFanProfileFixture('fa-thalita')).toMatchObject({
      uid: 'fa-thalita',
      displayName: 'Thalita Santos',
      username: 'thalitasan',
      restricted: false,
    });
    expect(Object.keys(COMMENT_AUTHOR_ALIASES)).toHaveLength(10);
    expect(Object.keys(COMMENT_ONLY_AUTHORS)).toEqual([
      'fa-alan',
      'fa-carla',
      'fa-diego',
      'fa-eduarda',
    ]);

    const artists = new Set(comments.filter((c) => c.authorIsArtist).map((c) => c.authorId));
    expect(artists.size).toBeGreaterThan(0);
    for (const id of artists) expect(() => buildFanProfileFixture(id)).toThrow(ApiError);
  });

  it('o "me", o id de uma central e o id que ninguém tem dão 404 fan_not_found, como a API', async () => {
    for (const id of ['me', 'nettobrito', 'fa-ninguem']) {
      const error = (() => {
        try {
          buildFanProfileFixture(id);
        } catch (caught) {
          return caught;
        }
        return null;
      })();
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ kind: 'notFound', status: 404, code: 'fan_not_found' });
    }
    await expect(fanProfileFixture('me')).rejects.toMatchObject({ code: 'fan_not_found' });
  });

  it('os @ são os do gerador do servidor, e nenhum se repete', () => {
    expect(fixtureUsername('Thalita Santos')).toBe('thalitasan');
    expect(fixtureUsername('Maria Clara Souza')).toBe('mariasou');
    expect(fixtureUsername('Júlia Ramos')).toBe('juliaram');
    expect(fixtureUsername('Pedro Henrique Alves')).toBe('pedroalv');
    expect(fixtureUsername('Renata Teixeira')).toBe('renatatei');
    expect(fixtureUsername('Carla M.')).toBe('carlam');
    expect(fixtureUsername('Duda Rocha')).toBe('dudaroc');

    const names = [
      ...RANKING_SEED.map((person) => person.displayName),
      ...Object.values(COMMENT_ONLY_AUTHORS),
    ];
    const usernames = names.map(fixtureUsername);
    expect(new Set(usernames).size).toBe(names.length);
    for (const username of usernames) expect(username).toMatch(/^[a-z]{3,15}$/);
  });
});

describe('a tabela de 28.10 (Thalita, Aline e Renata)', () => {
  it('as três linhas iguais às da nota, por fa-rank-NN', () => {
    expect(FAN_FIXTURE_DETAILS).toEqual({
      'fa-rank-01': {
        bio: 'Do arrocha ao piseiro, sigo o Netto em todo São João.\nIrará na veia.',
        gender: 'woman',
        privateAccount: false,
        suspended: false,
        socials: {
          instagram: 'thalita.teste.up',
          tiktok: 'thalita.teste.up',
          linkedin: 'thalita-teste-imagineup',
          x: 'thalitatesteup',
        },
      },
      'fa-rank-05': {
        bio: 'Conta de teste privada. Esta bio não aparece para os outros fãs.',
        gender: 'undisclosed',
        privateAccount: true,
        suspended: false,
        socials: { instagram: 'aline.teste.up', x: 'alinetesteup' },
      },
      'fa-rank-48': {
        bio: null,
        gender: null,
        privateAccount: false,
        suspended: true,
        socials: {},
      },
    });
    expect(RANKING_SEED.find((person) => person.userId === 'fa-rank-01')?.displayName).toBe(
      'Thalita Santos',
    );
    expect(RANKING_SEED.find((person) => person.userId === 'fa-rank-05')?.displayName).toBe(
      'Aline Ferreira',
    );
    expect(RANKING_SEED.find((person) => person.userId === 'fa-rank-48')?.displayName).toBe(
      'Renata Teixeira',
    );
  });

  it('as bios passam pela limpeza, até 200 e 6 linhas', () => {
    for (const [id, details] of Object.entries(FAN_FIXTURE_DETAILS)) {
      if (details.bio === null) continue;
      expect({ id, bio: cleanMultiline(details.bio) }).toEqual({ id, bio: details.bio });
      expect(isVisibleMultiline(details.bio)).toBe(true);
      expect(details.bio.length).toBeLessThanOrEqual(BIO_MAX);
      expect(details.bio.split('\n').length).toBeLessThanOrEqual(BIO_MAX_LINES);
    }
  });

  it('os usuários das redes passam pelo normalizador sem mudar e levam "teste"', () => {
    for (const [id, details] of Object.entries(FAN_FIXTURE_DETAILS)) {
      for (const network of SOCIAL_NETWORKS) {
        const handle = details.socials[network];
        if (handle === undefined) continue;
        expect({ id, network, result: normalizeSocialHandle(network, handle!) }).toEqual({
          id,
          network,
          result: { ok: true, handle },
        });
        expect(handle).toMatch(/teste/);
      }
    }
  });

  it('a Thalita sai completa, com as quatro redes e sem o gênero', () => {
    const thalita = buildFanProfileFixture('fa-rank-01');
    expect(thalita).toEqual({
      uid: 'fa-rank-01',
      displayName: 'Thalita Santos',
      username: 'thalitasan',
      photoURL: null,
      restricted: false,
      bio: 'Do arrocha ao piseiro, sigo o Netto em todo São João.\nIrará na veia.',
      socials: {
        instagram: 'thalita.teste.up',
        tiktok: 'thalita.teste.up',
        linkedin: 'thalita-teste-imagineup',
        x: 'thalitatesteup',
      },
    });
    expect(Object.keys(thalita)).toEqual(PUBLIC_KEYS);
  });

  it('a privada e a suspensa saem fechadas, com o mesmo corpo (fora o uid, o nome e o @)', () => {
    const aline = buildFanProfileFixture('fa-rank-05');
    const renata = buildFanProfileFixture('fa-rank-48');
    expect(aline).toMatchObject({ restricted: true, bio: null, socials: null });
    expect(renata).toMatchObject({ restricted: true, bio: null, socials: null });
    const body = (profile: typeof aline) => {
      const { uid: _uid, displayName: _name, username: _username, ...rest } = profile;
      return rest;
    };
    expect(body(aline)).toEqual(body(renata));
    expect(Object.keys(aline)).toEqual(PUBLIC_KEYS);
  });

  it('os outros só com a foto, o nome e o @: completos, sem bio nem redes', async () => {
    expect(await fanProfileFixture('fa-rank-04')).toEqual({
      uid: 'fa-rank-04',
      displayName: 'Maria Clara Souza',
      username: 'mariasou',
      photoURL: null,
      restricted: false,
      bio: null,
      socials: null,
    });
    expect(buildFanProfileFixture('fa-carla')).toMatchObject({
      displayName: 'Carla M.',
      username: 'carlam',
      bio: null,
      socials: null,
    });
  });
});
