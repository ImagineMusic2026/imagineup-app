import { describe, expect, it } from 'vitest';

import {
  ABANDONED_UPLOAD_MS,
  authorCopies,
  copiesDiffer,
  FAN_PROFILE_SLOW_WINDOW_MS,
  FAN_PROFILE_SYNC_WINDOW_MS,
  jpegDimensions,
  nextUsernameChange,
  normalizeUsername,
  parseFanPhotoPath,
  parseProfileSyncBudget,
  PHOTO_MAX_BYTES,
  photoProblem,
  photoTooOld,
  profileSyncBudget,
  profileSyncNeeded,
  stalePhotoFiles,
  USERNAME_CHANGE_INTERVAL_MS,
  usernameChangeAllowed,
  usernameRefusal,
  type ProfileSyncBudget,
} from './model';

// Relógio fixo: 15:00 em UTC, meio-dia em São Paulo.
const NOW = Date.parse('2026-10-07T15:00:00.000Z');
const MIN = 60_000;
const UID = 'Kq3vZ8wQb1TnUe0aRk5pL2mXy7Fd';

describe('normalizeUsername', () => {
  it.each([
    ['camilaribeiro', 'camilaribeiro'],
    ['  camilaribeiro  ', 'camilaribeiro'],
    ['@camilaribeiro', 'camilaribeiro'],
    [' @CamilaRibeiro ', 'camilaribeiro'],
    ['@@camila', '@camila'],
    // Acento não vira letra: continua inválido, e o fã vê o que mandou.
    ['CamilaRibeirõ', 'camilaribeirõ'],
  ])('%j vira %j', (raw, normalized) => {
    expect(normalizeUsername(raw)).toBe(normalized);
  });
});

describe('usernameRefusal', () => {
  it.each([
    ['ab', 'format'],
    ['a'.repeat(21), 'format'],
    ['camila_rib', 'format'],
    ['camila.rib', 'format'],
    ['camilaribeirõ', 'format'],
    ['@camila', 'format'],
    ['Camila', 'format'],
    ['fa123456', 'automatic'],
    ['fa12', 'automatic'],
    ['fa1', 'automatic'],
    ['admin', 'reserved'],
    ['adm1n', 'reserved'],
    ['1magine', 'reserved'],
    ['irnagineup', 'reserved'],
    ['suporte', 'reserved'],
    ['equipe', 'reserved'],
    ['ajuda', 'reserved'],
    ['contato', 'reserved'],
  ])('%s é recusado com %s', (username, reason) => {
    expect(usernameRefusal(username)).toBe(reason);
  });

  it.each(['camilaribeiro', 'abc', 'a'.repeat(20), 'fabio', 'ajudante', 'contatosil', 'mc2'])(
    '%s passa',
    (username) => {
      expect(usernameRefusal(username)).toBeNull();
    },
  );
});

describe('prazo da troca do @', () => {
  const changeableAt = nextUsernameChange(NOW);

  it('é a troca mais 30 dias', () => {
    expect(USERNAME_CHANGE_INTERVAL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(changeableAt).toBe(Date.parse('2026-11-06T15:00:00.000Z'));
  });

  it('libera na hora exata; um milissegundo antes, não', () => {
    expect(usernameChangeAllowed(changeableAt, changeableAt - 1)).toBe(false);
    expect(usernameChangeAllowed(changeableAt, changeableAt)).toBe(true);
    expect(usernameChangeAllowed(changeableAt, changeableAt + 1)).toBe(true);
  });

  it('sem prazo gravado (o @ do cadastro, ou o liberado pelo script), livre', () => {
    expect(usernameChangeAllowed(null, NOW)).toBe(true);
  });
});

describe('parseFanPhotoPath', () => {
  it('separa o uid e o nome do arquivo', () => {
    expect(parseFanPhotoPath(`fans/${UID}/photo-mg5k2x1a-4f9z0abc.jpg`)).toEqual({
      uid: UID,
      fileName: 'photo-mg5k2x1a-4f9z0abc.jpg',
    });
  });

  it.each([
    [`fans/${UID}/photo-mg5k2x1a-4f9z0abc.jpeg`],
    [`fans/${UID}/photo-MG5K2X1A.jpg`],
    [`fans/${UID}/photo-abc.jpg`],
    [`fans/${UID}/photo-${'a'.repeat(41)}.jpg`],
    [`fans/${UID}/avatar.jpg`],
    [`fans/${UID}/sub/photo-mg5k2x1a.jpg`],
    [`fans/${UID}/../outro/photo-mg5k2x1a.jpg`],
    [`fans/a.b/photo-mg5k2x1a.jpg`],
    [`artists/nenho/photo-mg5k2x1a.jpg`],
    [`/fans/${UID}/photo-mg5k2x1a.jpg`],
    [`fans//photo-mg5k2x1a.jpg`],
    [null],
    [42],
  ])('%j é recusado', (path) => {
    expect(parseFanPhotoPath(path)).toBeNull();
  });

  it('id de 8 e de 40 passam', () => {
    expect(parseFanPhotoPath(`fans/${UID}/photo-${'a'.repeat(8)}.jpg`)).not.toBeNull();
    expect(parseFanPhotoPath(`fans/${UID}/photo-${'a'.repeat(40)}.jpg`)).not.toBeNull();
  });
});

// --- JPEG ----------------------------------------------------------------------

/** Segmento com o marcador e o conteúdo (o tamanho conta os 2 bytes dele). */
function segment(marker: number, body: number[]): number[] {
  const length = body.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...body];
}

/** SOF de largura por altura (precisão 8, 3 componentes). */
const sof = (marker: number, width: number, height: number) =>
  segment(marker, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0]);

const SOI = [0xff, 0xd8];
const APP0 = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const jpeg = (...parts: number[][]) => Uint8Array.from(parts.flat());

describe('jpegDimensions', () => {
  it('lê o SOF0 depois dos segmentos APP', () => {
    expect(jpegDimensions(jpeg(SOI, APP0, segment(0xe1, [1, 2, 3]), sof(0xc0, 512, 480)))).toEqual({
      width: 512,
      height: 480,
    });
  });

  it('lê o SOF2 (progressivo) e pula os bytes de preenchimento', () => {
    expect(jpegDimensions(jpeg(SOI, [0xff], APP0, sof(0xc2, 300, 200)))).toEqual({
      width: 300,
      height: 200,
    });
  });

  it('a tabela de Huffman (FFC4) não é SOF', () => {
    expect(
      jpegDimensions(jpeg(SOI, segment(0xc4, [0, 1, 2, 3, 4, 5, 6, 7, 8]), sof(0xc0, 64, 32))),
    ).toEqual({ width: 64, height: 32 });
  });

  it('sem SOF nos bytes lidos: null', () => {
    expect(jpegDimensions(jpeg(SOI, APP0, segment(0xe1, new Array(100).fill(0))))).toBeNull();
    // Os dados (SOS) antes de qualquer SOF.
    expect(jpegDimensions(jpeg(SOI, APP0, segment(0xda, [1, 2]), sof(0xc0, 1, 1)))).toBeNull();
  });

  it('segmento cortado no meio: null', () => {
    expect(
      jpegDimensions(jpeg(SOI, APP0, sof(0xc0, 512, 512)).slice(0, 2 + APP0.length + 6)),
    ).toBeNull();
    expect(jpegDimensions(jpeg(SOI, [0xff, 0xe0, 0x10]))).toBeNull();
  });

  it('o que não começa com o SOI: null', () => {
    expect(jpegDimensions(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBeNull();
    expect(jpegDimensions(new Uint8Array())).toBeNull();
  });
});

describe('photoProblem', () => {
  const good = jpeg(SOI, APP0, sof(0xc0, 512, 512));
  const file = (extra: Partial<{ contentType: string | null; size: number }> = {}) => ({
    contentType: 'image/jpeg',
    size: 48_000,
    ...extra,
  });

  it('o JPEG de 512 passa, e 1024 × 1024 também', () => {
    expect(photoProblem(file(), good)).toBeNull();
    expect(photoProblem(file(), jpeg(SOI, sof(0xc0, 1024, 1024)))).toBeNull();
  });

  it('o tipo vem antes de tudo', () => {
    expect(photoProblem(file({ contentType: 'image/png' }), good)).toBe('type');
    expect(photoProblem(file({ contentType: 'image/jpeg; charset=utf-8' }), good)).toBe('type');
    expect(photoProblem(file({ contentType: null }), good)).toBe('type');
  });

  it('tamanho: 0 byte não, 1 MiB exato sim, 1 MiB mais 1 não', () => {
    expect(photoProblem(file({ size: 0 }), good)).toBe('size');
    expect(photoProblem(file({ size: PHOTO_MAX_BYTES }), good)).toBeNull();
    expect(photoProblem(file({ size: PHOTO_MAX_BYTES + 1 }), good)).toBe('size');
    expect(photoProblem({ contentType: 'image/jpeg' }, good)).toBe('size');
  });

  it('sem o começo do arquivo, só os metadados', () => {
    expect(photoProblem(file())).toBeNull();
    expect(photoProblem(file({ contentType: 'image/png' }))).toBe('type');
  });

  it('bytes que não são JPEG: content (um PNG com image/jpeg, ou o JPEG sem SOF)', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(photoProblem(file(), png)).toBe('content');
    expect(photoProblem(file(), Uint8Array.from([0xff, 0xd8, 0x00, 0x00]))).toBe('content');
    expect(photoProblem(file(), jpeg(SOI, APP0))).toBe('content');
  });

  it('dimensões: 1025 de largura ou de altura e 0 são dimensions', () => {
    expect(photoProblem(file(), jpeg(SOI, sof(0xc0, 1025, 512)))).toBe('dimensions');
    expect(photoProblem(file(), jpeg(SOI, sof(0xc0, 512, 1025)))).toBe('dimensions');
    expect(photoProblem(file(), jpeg(SOI, sof(0xc0, 2000, 2000)))).toBe('dimensions');
    expect(photoProblem(file(), jpeg(SOI, sof(0xc0, 0, 512)))).toBe('dimensions');
    expect(photoProblem(file(), jpeg(SOI, sof(0xc0, 512, 0)))).toBe('dimensions');
  });
});

describe('photoTooOld', () => {
  it('10 min exatos passam; 10 min e 1 ms, não', () => {
    expect(photoTooOld({ timeCreated: NOW - 10 * MIN }, null, NOW)).toBe(false);
    expect(photoTooOld({ timeCreated: NOW - 10 * MIN - 1 }, null, NOW)).toBe(true);
  });

  it('o arquivo de antes da última troca de foto não vira a foto', () => {
    expect(photoTooOld({ timeCreated: NOW - 2 * MIN }, NOW - MIN, NOW)).toBe(true);
    expect(photoTooOld({ timeCreated: NOW - MIN }, NOW - MIN, NOW)).toBe(false);
    expect(photoTooOld({ timeCreated: NOW - MIN }, NOW - 2 * MIN, NOW)).toBe(false);
  });

  it('sem photoUpdatedAt, só a idade conta; sem carimbo do Storage, recusa', () => {
    expect(photoTooOld({ timeCreated: NOW - 9 * MIN }, null, NOW)).toBe(false);
    expect(photoTooOld({}, null, NOW)).toBe(true);
  });
});

describe('stalePhotoFiles', () => {
  const at = (path: string, minutesAgo: number) => ({
    path: `fans/${UID}/${path}`,
    timeCreated: NOW - minutesAgo * MIN,
  });

  it('a foto de agora fica, mesmo antiga', () => {
    expect(
      stalePhotoFiles(
        [at('photo-agora0001.jpg', 300)],
        {
          photoPath: `fans/${UID}/photo-agora0001.jpg`,
          photoUpdatedAt: NOW - 300 * MIN,
        },
        NOW,
      ),
    ).toEqual([]);
  });

  it('o envio de antes do photoUpdatedAt sai com 1 min; o de depois fica com 14 e sai com 16', () => {
    const profile = { photoPath: `fans/${UID}/photo-agora0001.jpg`, photoUpdatedAt: NOW - 30_000 };
    expect(
      stalePhotoFiles(
        [
          at('photo-agora0001.jpg', 0.5),
          at('photo-falhou01.jpg', 1),
          at('photo-depois01.jpg', 0.1),
        ],
        profile,
        NOW,
      ),
    ).toEqual([`fans/${UID}/photo-falhou01.jpg`]);
    const later = { path: `fans/${UID}/photo-depois01.jpg`, timeCreated: NOW };
    expect(stalePhotoFiles([later], profile, NOW + 14 * MIN)).toEqual([]);
    expect(stalePhotoFiles([later], profile, NOW + 16 * MIN)).toEqual([later.path]);
    expect(ABANDONED_UPLOAD_MS).toBe(15 * MIN);
  });

  it('sem photoUpdatedAt (nunca teve foto), só os de mais de 15 min; sem carimbo, sai', () => {
    const profile = { photoPath: null, photoUpdatedAt: null };
    expect(
      stalePhotoFiles([at('photo-novo0001.jpg', 14), at('photo-velho001.jpg', 16)], profile, NOW),
    ).toEqual([`fans/${UID}/photo-velho001.jpg`]);
    expect(stalePhotoFiles([{ path: 'x', timeCreated: null }], profile, NOW)).toEqual(['x']);
  });
});

describe('cópias do autor nos comentários', () => {
  it('sem nome vira "Fã", sem foto vira null', () => {
    expect(authorCopies({ displayName: 'Camila Ribeiro', photoURL: 'https://x/a.jpg' })).toEqual({
      authorName: 'Camila Ribeiro',
      authorPhotoURL: 'https://x/a.jpg',
    });
    expect(authorCopies({ displayName: null, photoURL: null })).toEqual({
      authorName: 'Fã',
      authorPhotoURL: null,
    });
    expect(authorCopies({ displayName: '', photoURL: '' })).toEqual({
      authorName: 'Fã',
      authorPhotoURL: null,
    });
    expect(authorCopies({})).toEqual({ authorName: 'Fã', authorPhotoURL: null });
  });

  it('a cópia diferente é regravada; a igual, não', () => {
    const copies = { authorName: 'Camila', authorPhotoURL: null };
    expect(copiesDiffer({ authorName: 'Camila', authorPhotoURL: null }, copies)).toBe(false);
    expect(copiesDiffer({ authorName: 'Camila' }, copies)).toBe(false);
    expect(copiesDiffer({ authorName: 'Cami', authorPhotoURL: null }, copies)).toBe(true);
    expect(copiesDiffer({ authorName: 'Camila', authorPhotoURL: 'https://x' }, copies)).toBe(true);
  });
});

describe('profileSyncNeeded', () => {
  const base = {
    displayName: 'Camila',
    city: 'Irará',
    username: 'camilarib',
    photoURL: null,
    photoPath: null,
    updatedAt: 1,
  };

  it.each([
    ['displayName', 'Camila Ribeiro'],
    ['photoURL', 'https://x/a.jpg'],
    ['photoPath', `fans/${UID}/photo-agora0001.jpg`],
  ])('%s põe tarefa', (field, value) => {
    expect(profileSyncNeeded(base, { ...base, [field]: value })).toBe(true);
  });

  it.each([
    ['city', 'Feira de Santana, BA'],
    ['username', 'camilaribeiro'],
    ['updatedAt', 2],
  ])('%s sozinho não põe', (field, value) => {
    expect(profileSyncNeeded(base, { ...base, [field]: value })).toBe(false);
  });

  it('ausente vale null; sem um dos lados, nada', () => {
    const { photoURL: _url, ...withoutPhoto } = base;
    expect(profileSyncNeeded(base, withoutPhoto)).toBe(false);
    expect(profileSyncNeeded(undefined, base)).toBe(false);
  });
});

describe('profileSyncBudget', () => {
  const window = (at: number) => Math.floor(at / FAN_PROFILE_SYNC_WINDOW_MS);
  const day = '2026-10-07';

  it('abaixo de 12, a janela de 5 min, contada uma vez por janela', () => {
    const first = profileSyncBudget(null, NOW);
    expect(first).toEqual({
      prefix: 'fanprofile',
      windowMs: FAN_PROFILE_SYNC_WINDOW_MS,
      write: { day, windows: 1, lastWindow: window(NOW) },
    });
    // A mesma janela (outra mudança, ou a entrega repetida do mesmo evento): nada a gravar.
    expect(profileSyncBudget(first.write, NOW + 1_000)).toEqual({ ...first, write: null });
    expect(profileSyncBudget(first.write, NOW).write).toBeNull();
    expect(profileSyncBudget(first.write, NOW + 5 * MIN).write).toEqual({
      day,
      windows: 2,
      lastWindow: window(NOW + 5 * MIN),
    });
  });

  it('a 13ª janela vai para a de 1 h, sem gravar; a 12ª, já contada, segue na de 5 min', () => {
    const full: ProfileSyncBudget = { day, windows: 12, lastWindow: window(NOW) };
    expect(profileSyncBudget(full, NOW + 5 * MIN)).toEqual({
      prefix: 'fanprofileh',
      windowMs: FAN_PROFILE_SLOW_WINDOW_MS,
      write: null,
    });
    expect(profileSyncBudget(full, NOW + 1_000)).toEqual({
      prefix: 'fanprofile',
      windowMs: FAN_PROFILE_SYNC_WINDOW_MS,
      write: null,
    });
    const eleven: ProfileSyncBudget = { day, windows: 11, lastWindow: window(NOW) - 1 };
    expect(profileSyncBudget(eleven, NOW).write).toEqual({
      day,
      windows: 12,
      lastWindow: window(NOW),
    });
  });

  it('o dia seguinte de São Paulo zera a conta (meia-noite de lá, 3 h em UTC)', () => {
    const full: ProfileSyncBudget = { day, windows: 12, lastWindow: 1 };
    const beforeMidnight = Date.parse('2026-10-08T02:59:59.000Z');
    const afterMidnight = Date.parse('2026-10-08T03:00:00.000Z');
    expect(profileSyncBudget(full, beforeMidnight).prefix).toBe('fanprofileh');
    expect(profileSyncBudget(full, afterMidnight)).toEqual({
      prefix: 'fanprofile',
      windowMs: FAN_PROFILE_SYNC_WINDOW_MS,
      write: { day: '2026-10-08', windows: 1, lastWindow: window(afterMidnight) },
    });
  });

  it('o orçamento guardado fora do formato vale como nenhum', () => {
    expect(parseProfileSyncBudget(undefined)).toBeNull();
    expect(parseProfileSyncBudget({ day: 1, windows: 2 })).toBeNull();
    expect(parseProfileSyncBudget({ day, windows: 3 })).toEqual({
      day,
      windows: 3,
      lastWindow: null,
    });
  });
});
