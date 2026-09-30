import { describe, expect, it } from 'vitest';

import { artistError, errorReason } from './errors';
import {
  artistPrefix,
  deleteProblem,
  GENRES,
  handleProblem,
  imageSize,
  isArtistFilePath,
  isImageContentType,
  nextOrder,
  parseArtistId,
  parseArtistIds,
  parseArtistName,
  parseBio,
  parseCity,
  parseContactEmail,
  parseContactPhone,
  parseFlag,
  parseGenre,
  parseHandle,
  parseManagerUid,
  parsePhotoPaths,
  parseShortName,
  parseTargetStatus,
  PHOTO_SIZE,
  publishProblems,
  REORDER_MAX,
  reorderChanges,
  RESERVED_HANDLES,
  staleArtistFiles,
  suggestHandle,
  THUMB_SIZE,
} from './model';

/** Motivo (details.reason) do erro que a função lança. */
function reasonOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return errorReason(error);
  }
  return undefined;
}

describe('@ da central', () => {
  it('sugestão a partir do nome: sem acento, minúsculo, só letras e números, até 30', () => {
    expect(suggestHandle('Trio Bem Bahia')).toBe('triobembahia');
    expect(suggestHandle('Juninho Maré')).toBe('juninhomare');
    expect(suggestHandle('Forró do Açaí 2')).toBe('forrodoacai2');
    expect(suggestHandle('MC Zé_da-Silva!')).toBe('mczedasilva');
    expect(suggestHandle('Banda '.repeat(10))).toBe('banda'.repeat(6));
    expect(suggestHandle('\u{1F469}\u200D\u{1F3A4}')).toBe('');
  });

  it('formato: 3 a 30 de a-z, 0-9 e _', () => {
    for (const handle of ['abc', 'trio_bem_bahia', 'x'.repeat(30), 'mc_2']) {
      expect(handleProblem(handle)).toBeNull();
      expect(parseHandle(handle)).toBe(handle);
    }
    for (const handle of [
      'ab',
      'x'.repeat(31),
      'Trio',
      'trio bem',
      'trio-bem',
      'forró',
      'trio.bem',
      '',
      null,
      12,
    ]) {
      expect(handleProblem(handle)).toBe('invalid');
      expect(reasonOf(() => parseHandle(handle))).toBe('invalid-handle');
    }
  });

  it('reservados nunca ficam disponíveis', () => {
    expect(RESERVED_HANDLES).toEqual([
      'admin',
      'imagine',
      'imagineup',
      'imaginemusic',
      'equipe',
      'suporte',
      'staff',
      'oficial',
      'ajuda',
      'contato',
    ]);
    for (const handle of RESERVED_HANDLES) {
      expect(handleProblem(handle)).toBe('reserved');
      expect(reasonOf(() => parseHandle(handle))).toBe('handle-reserved');
    }
    // Só o @ exato: nomes que contêm a palavra seguem livres.
    expect(handleProblem('contatos_do_trio')).toBeNull();
  });

  it('ids que o Firestore reserva (__.*__) são @ inválidos, mesmo cabendo no formato', () => {
    for (const handle of ['____', '__x__', '__trio__', '__admin__', `__${'a'.repeat(26)}__`]) {
      expect(handleProblem(handle)).toBe('invalid');
      expect(reasonOf(() => parseHandle(handle))).toBe('invalid-handle');
      expect(reasonOf(() => parseArtistId(handle))).toBe('artist-not-found');
    }
    // Sublinhado só numa ponta, ou menos de dois em cada, segue valendo.
    for (const handle of ['___', '__trio', 'trio__', '_trio_', '__trio_', 'a__b__']) {
      expect(handleProblem(handle)).toBeNull();
      expect(parseArtistId(handle)).toBe(handle);
    }
  });

  it('id de central fora do formato é central que não existe', () => {
    expect(parseArtistId('triobembahia')).toBe('triobembahia');
    for (const id of ['../x', 'Trio', 'a/b', '', undefined]) {
      expect(reasonOf(() => parseArtistId(id))).toBe('artist-not-found');
    }
  });
});

describe('textos da central', () => {
  it('nome artístico: NFC, sem espaço nas pontas, 1 a 60, uma linha visível', () => {
    expect(parseArtistName('  Juninho Maré ')).toBe('Juninho Maré');
    expect(parseArtistName('Jose\u0301')).toBe('José');
    expect(parseArtistName('\u{1F469}\u200D\u{1F3A4} Cantora')).toBe(
      '\u{1F469}\u200D\u{1F3A4} Cantora',
    );
    expect(parseArtistName('a'.repeat(60))).toHaveLength(60);
    for (const name of [
      '',
      '   ',
      'a'.repeat(61),
      'Duas\nlinhas',
      'Invisível\u2066',
      null,
      undefined,
      3,
    ]) {
      expect(reasonOf(() => parseArtistName(name))).toBe('invalid-name');
    }
  });

  it('nome curto: opcional, até 20', () => {
    expect(parseShortName('Juninho M.')).toBe('Juninho M.');
    expect(parseShortName(null)).toBeNull();
    expect(parseShortName(undefined)).toBeNull();
    expect(parseShortName('  ')).toBeNull();
    expect(reasonOf(() => parseShortName('a'.repeat(21)))).toBe('invalid-short-name');
    expect(reasonOf(() => parseShortName('Tab\tno meio'))).toBe('invalid-short-name');
  });

  it('cidade: opcional, até 60', () => {
    expect(parseCity(' Salvador, BA ')).toBe('Salvador, BA');
    expect(parseCity('')).toBeNull();
    expect(parseCity(undefined)).toBeNull();
    expect(reasonOf(() => parseCity('a'.repeat(61)))).toBe('invalid-city');
    expect(reasonOf(() => parseCity('ㅤ'))).toBe('invalid-city');
  });

  it('gênero: um da lista, escrito igual', () => {
    expect(GENRES).toContain('Forró pé de serra');
    expect(GENRES.at(-1)).toBe('Outro');
    expect(parseGenre('Piseiro')).toBe('Piseiro');
    expect(parseGenre(null)).toBeNull();
    expect(parseGenre(undefined)).toBeNull();
    for (const genre of ['piseiro', 'Rock', 'Forro', 1]) {
      expect(reasonOf(() => parseGenre(genre))).toBe('invalid-genre');
    }
  });

  it('bio: quebras de linha valem; linhas vazias seguidas viram uma e as das pontas saem', () => {
    expect(parseBio('Primeira linha\r\nSegunda linha')).toBe('Primeira linha\nSegunda linha');
    expect(parseBio('\n\n  Parágrafo um  \n\n\n\nParágrafo dois\n\n')).toBe(
      'Parágrafo um\n\nParágrafo dois',
    );
    expect(parseBio('   \n  ')).toBeNull();
    expect(parseBio(null)).toBeNull();
    expect(parseBio(undefined)).toBeNull();
    expect(parseBio('a'.repeat(500))).toHaveLength(500);
  });

  it('bio: até 500 e sem controle nem invisíveis em nenhuma linha', () => {
    for (const bio of [
      'a'.repeat(501),
      'Linha boa\nLinha com\u200Binvisível',
      'Tab\tno meio',
      'Fim\u2028de linha',
      7,
    ]) {
      expect(reasonOf(() => parseBio(bio))).toBe('invalid-bio');
    }
  });
});

describe('contato da central', () => {
  it('e-mail: opcional, minúsculo, no formato de e-mail', () => {
    expect(parseContactEmail(' Contato@TrioBem.COM ')).toBe('contato@triobem.com');
    expect(parseContactEmail('')).toBeNull();
    expect(parseContactEmail(null)).toBeNull();
    expect(parseContactEmail(undefined)).toBeNull();
    for (const email of ['contato', 'contato@trio', 'a b@c.io', 5]) {
      expect(reasonOf(() => parseContactEmail(email))).toBe('invalid-email');
    }
  });

  it('celular: tira espaços, parênteses e traços; + opcional e 10 a 15 dígitos', () => {
    expect(parseContactPhone('(71) 99876-5432')).toBe('71998765432');
    expect(parseContactPhone('+55 71 99876-5432')).toBe('+5571998765432');
    expect(parseContactPhone('71 3321\u20131234')).toBe('7133211234');
    expect(parseContactPhone('  ')).toBeNull();
    expect(parseContactPhone(null)).toBeNull();
    expect(parseContactPhone(undefined)).toBeNull();
    for (const phone of [
      '9876-5432',
      '1'.repeat(16),
      '55+71998765432',
      '71.99876.5432',
      '(71) 9987a-5432',
      71998765432,
    ]) {
      expect(reasonOf(() => parseContactPhone(phone))).toBe('invalid-phone');
    }
  });

  it('gestor: opcional, um uid (a equipe ativa é conferida no banco)', () => {
    expect(parseManagerUid('abc123')).toBe('abc123');
    expect(parseManagerUid(null)).toBeNull();
    expect(parseManagerUid(undefined)).toBeNull();
    expect(parseManagerUid('')).toBeNull();
    for (const uid of ['a/b', '..', 'x'.repeat(129), 3]) {
      expect(reasonOf(() => parseManagerUid(uid))).toBe('invalid-manager');
    }
  });

  it('selo e autorização precisam ser true ou false', () => {
    expect(parseFlag(true)).toBe(true);
    expect(parseFlag(false)).toBe(false);
    for (const value of ['true', 1, null, undefined]) {
      expect(reasonOf(() => parseFlag(value))).toBe('invalid-request');
    }
  });
});

describe('fotos', () => {
  it('caminho: arquivo direto em artists/{id}/', () => {
    expect(artistPrefix('trio')).toBe('artists/trio/');
    expect(isArtistFilePath('artists/trio/photo-1790000000000-1200.webp', 'trio')).toBe(true);
    for (const path of [
      'artists/outro/photo.webp',
      'artists/trio/',
      'artists/trio/sub/photo.webp',
      'artists/trio/..',
      'artists/triozinho/photo.webp',
      'users/trio/photo.webp',
      'artists/trio/foto com espaço.webp',
      null,
    ]) {
      expect(isArtistFilePath(path, 'trio')).toBe(false);
    }
  });

  it('photo do updateArtist: null tira; senão, os dois caminhos desta central', () => {
    expect(parsePhotoPaths(null, 'trio')).toBeNull();
    expect(
      parsePhotoPaths(
        { photoPath: 'artists/trio/p.webp', thumbPath: 'artists/trio/t.webp' },
        'trio',
      ),
    ).toEqual({ photoPath: 'artists/trio/p.webp', thumbPath: 'artists/trio/t.webp' });
    for (const photo of [
      { photoPath: 'artists/outro/p.webp', thumbPath: 'artists/trio/t.webp' },
      { photoPath: 'artists/trio/p.webp' },
      { photoPath: 'artists/trio/p.webp', thumbPath: 'artists/trio/p.webp' },
      'artists/trio/p.webp',
      [],
    ]) {
      expect(reasonOf(() => parsePhotoPaths(photo, 'trio'))).toBe('invalid-photo');
    }
  });

  it('limpeza da pasta: sai tudo de artists/{id}/, menos as fotos que ficam', () => {
    const photo = 'artists/trio/photo-2-1200.webp';
    const thumb = 'artists/trio/thumb-2-480.webp';
    const folder = [
      'artists/trio/photo-1-1200.webp',
      'artists/trio/thumb-1-480.webp',
      photo,
      thumb,
      'artists/trio/photo-abandonada.webp',
    ];
    expect(staleArtistFiles(folder, 'trio', [photo, thumb])).toEqual([
      'artists/trio/photo-1-1200.webp',
      'artists/trio/thumb-1-480.webp',
      'artists/trio/photo-abandonada.webp',
    ]);
    // As fotos novas nunca saem, nem repetidas na lista.
    const stale = staleArtistFiles([...folder, photo, thumb], 'trio', [photo, thumb, null]);
    expect(stale).not.toContain(photo);
    expect(stale).not.toContain(thumb);
    // Tirar a foto: a pasta inteira sai.
    expect(staleArtistFiles(folder, 'trio', [undefined, null])).toEqual(folder);
    // Arquivo de outra pasta (outra central, mesmo começo de @) nunca entra.
    expect(
      staleArtistFiles(
        ['artists/triozinho/photo.webp', 'artists/outro/photo.webp', 'users/trio/photo.webp'],
        'trio',
        [],
      ),
    ).toEqual([]);
    expect(staleArtistFiles([], 'trio', [photo])).toEqual([]);
  });

  it('só webp, jpeg e png contam como imagem', () => {
    for (const type of ['image/webp', 'image/jpeg', 'image/png']) {
      expect(isImageContentType(type)).toBe(true);
    }
    for (const type of [
      'image/gif',
      'image/heic',
      'image/svg+xml',
      'text/plain',
      'image/webp; x',
      null,
    ]) {
      expect(isImageContentType(type)).toBe(false);
    }
  });

  it('largura e altura do metadado do upload; faltou ou veio estranho, o tamanho padrão', () => {
    expect(PHOTO_SIZE).toEqual({ width: 1200, height: 1600 });
    expect(THUMB_SIZE).toEqual({ width: 480, height: 640 });
    expect(imageSize({ width: '900', height: '1200' }, PHOTO_SIZE)).toEqual({
      width: 900,
      height: 1200,
    });
    expect(imageSize({ width: 480, height: 640 }, PHOTO_SIZE)).toEqual({ width: 480, height: 640 });
    for (const metadata of [
      undefined,
      {},
      { width: '1200' },
      { width: '0', height: '1600' },
      { width: '1200px', height: '1600' },
      { width: '99999', height: '1600' },
    ]) {
      expect(imageSize(metadata, THUMB_SIZE)).toEqual({ width: 480, height: 640 });
    }
  });
});

describe('publicar e ordenar', () => {
  const image = { url: 'u', path: 'p', width: 1, height: 1 };

  it('publicar exige as duas fotos e a autorização de imagem', () => {
    expect(publishProblems({ photo: image, thumb: image, imageRightsConfirmed: true })).toEqual([]);
    expect(publishProblems({ photo: null, thumb: null, imageRightsConfirmed: false })).toEqual([
      'missing-photo',
      'missing-image-rights',
    ]);
    expect(publishProblems({ photo: image, thumb: null, imageRightsConfirmed: true })).toEqual([
      'missing-photo',
    ]);
  });

  it('apagar: em qualquer status, menos central com fãs', () => {
    expect(deleteProblem({ fanCount: 0 })).toBeNull();
    expect(deleteProblem({ fanCount: 3 })).toBe('has-fans');
    expect(deleteProblem({ fanCount: 1 })).toBe('has-fans');
    // fanCount é do servidor e sempre número; ausente conta como 0.
    expect(deleteProblem({ fanCount: undefined })).toBeNull();
    const error = artistError('has-fans');
    expect(error.code).toBe('failed-precondition');
    expect(error.message).toBe('Essa central tem fãs. Tire do ar em vez de apagar.');
    expect(errorReason(error)).toBe('has-fans');
  });

  it('status pedido: published ou unpublished', () => {
    expect(parseTargetStatus('published')).toBe('published');
    expect(parseTargetStatus('unpublished')).toBe('unpublished');
    for (const status of ['draft', 'Published', null]) {
      expect(reasonOf(() => parseTargetStatus(status))).toBe('invalid-request');
    }
  });

  it('central nova vai para o fim da ordem', () => {
    expect(nextOrder([])).toBe(0);
    expect(nextOrder([4])).toBe(5);
    expect(nextOrder([undefined, 'x'])).toBe(0);
  });

  it('lista da reordenação: sem repetir e dentro do teto', () => {
    expect(parseArtistIds(['b', 'a'].map((x) => x.repeat(3)))).toEqual(['bbb', 'aaa']);
    for (const ids of [
      [],
      'aaa',
      ['aaa', 'aaa'],
      [1],
      Array.from({ length: REORDER_MAX + 1 }, (_, i) => `a${i}xx`),
    ]) {
      expect(reasonOf(() => parseArtistIds(ids))).toBe('invalid-request');
    }
    expect(reasonOf(() => parseArtistIds(['aaa', 'Nao/Existe']))).toBe('unknown-artist');
    expect(reasonOf(() => parseArtistIds(['aaa', '__x__']))).toBe('unknown-artist');
  });

  it('a lista cheia cabe numa transação: duas gravações por central e a auditoria', () => {
    const full = Array.from({ length: REORDER_MAX }, (_, i) => `a${i}xx`);
    expect(parseArtistIds(full)).toEqual(full);
    expect(REORDER_MAX * 2 + 1).toBeLessThanOrEqual(500);
  });

  it('order = posição; volta só quem mudou de lugar', () => {
    const current = [
      { id: 'aaa', order: 0 },
      { id: 'bbb', order: 1 },
      { id: 'ccc', order: 2 },
    ];
    expect(reorderChanges(current, ['aaa', 'ccc', 'bbb'])).toEqual([
      { id: 'ccc', order: 1 },
      { id: 'bbb', order: 2 },
    ]);
    expect(reorderChanges(current, ['aaa', 'bbb', 'ccc'])).toEqual([]);
    // Ordem repetida (duas criadas ao mesmo tempo) é consertada.
    expect(
      reorderChanges(
        [
          { id: 'aaa', order: 0 },
          { id: 'bbb', order: 0 },
        ],
        ['aaa', 'bbb'],
      ),
    ).toEqual([{ id: 'bbb', order: 1 }]);
  });

  it('id que não existe é unknown-artist; faltar central é incomplete-list', () => {
    const current = [
      { id: 'aaa', order: 0 },
      { id: 'bbb', order: 1 },
    ];
    expect(reasonOf(() => reorderChanges(current, ['aaa', 'bbb', 'zzz']))).toBe('unknown-artist');
    expect(reasonOf(() => reorderChanges(current, ['bbb']))).toBe('incomplete-list');
  });
});
