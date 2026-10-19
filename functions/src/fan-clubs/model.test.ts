import { describe, expect, it, vi } from 'vitest';

import {
  APPLICATION_KEYS,
  applicationRecord,
  applicationTurn,
  checkClubName,
  CLUB_PHOTO_LIMITS,
  CLUB_THUMB_LIMITS,
  FAN_CLUB_HISTORY_MAX,
  FAN_CLUB_PENDING_MAX,
  FAN_CLUB_POSTS_PER_DAY,
  FAN_CLUB_UPLOAD_SLOT_MS,
  FAN_CLUB_UPLOADS_PER_DAY,
  FAN_CLUB_OPEN,
  FAN_CLUB_PRIZE_NOTICE,
  FAN_CLUB_REAPPLY_MS,
  FAN_CLUB_RULES_URL,
  FAN_CLUB_RULES_VERSION,
  fanClubBoxes,
  fanClubBoxValue,
  FanClubError,
  fanClubMediaFolder,
  fanClubPostRecord,
  fanClubRecord,
  fanClubReportId,
  fanClubRulesUrl,
  hasOfficialWord,
  isFeaturedNow,
  parseApplication,
  parseFeaturedUntil,
  parsePost,
  parseRulesAcceptance,
  postMediaPaths,
  reapplyAfterRejection,
  sameProportion,
  slotFileNames,
  slotNamesOf,
  withHistory,
  type ApplicationHistoryItem,
  type ApplicationRecord,
} from './model';

// O fã-clube gerido pelo fã, puro (docs/arquitetura-api.md, 34.13): as
// constantes do programa, o nome, o texto de divulgação, o corpo da
// candidatura, a candidatura de novo (a rodada, o prazo e as recusas), as
// caixas por artista e o prazo do Destaque, com o relógio fixo. Desde a
// etapa 2, a publicação: os tetos, o corpo, o novo aceite, a vaga e a leitura
// do documento.

// O filtro do que o fã publica (seção 30) trocado por um de palavras neutras:
// nenhum termo da lista de verdade entra no repositório (30.11).
vi.mock('../content-filter', async (importOriginal) => {
  const { fakeContentFilter } = await import('../../test/content-filter-fake.js');
  return fakeContentFilter(await importOriginal());
});

// 12:00 de 19/10/2026 em São Paulo.
const NOW = Date.parse('2026-10-19T15:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const PITCH = 'Divulgo o artista nos stories e no grupo dos fãs da cidade.';

const body = (extra: Record<string, unknown> = {}) => ({
  artistId: 'nettobrito',
  name: 'Netto de Coração',
  instagram: 'camila.teste.up',
  tiktok: null,
  whatsapp: '(75) 99123-4567',
  pitch: PITCH,
  adult: true,
  rulesVersion: FAN_CLUB_RULES_VERSION,
  ...extra,
});

/** O erro que a chamada lança (ou falha o teste). */
function errorOf(run: () => unknown): FanClubError {
  try {
    run();
  } catch (error) {
    if (error instanceof FanClubError) return error;
    throw error;
  }
  throw new Error('Deveria ter falhado.');
}

const application = (fields: Partial<ApplicationRecord> = {}): ApplicationRecord => ({
  uid: 'uidCamila',
  artistId: 'nettobrito',
  artistName: 'Netto Brito',
  status: 'rejected',
  round: 1,
  proposedName: 'Netto de Coração',
  rulesVersion: FAN_CLUB_RULES_VERSION,
  rulesAcceptedAt: NOW,
  adultDeclared: true,
  submittedAt: NOW,
  decidedAt: NOW,
  rejectReason: 'incomplete',
  canReapplyAt: null,
  clubId: null,
  closedByStaff: false,
  history: [],
  ...fields,
});

describe('o programa (decisões 8, 9 e 47)', () => {
  it('aberto, sem o regulamento, com a versão dos termos e o texto do reconhecimento ligado', () => {
    expect(FAN_CLUB_OPEN).toBe(true);
    expect(FAN_CLUB_RULES_URL).toBe('');
    expect(fanClubRulesUrl()).toBeNull();
    expect(fanClubRulesUrl('https://imagineup.app/fa-clube/regulamento')).toBe(
      'https://imagineup.app/fa-clube/regulamento',
    );
    expect(FAN_CLUB_RULES_VERSION).toBe('termos-2026-10');
    expect(FAN_CLUB_PRIZE_NOTICE).toContain('sem inscrição, ranking, prazo nem prêmio garantido');
    expect(FAN_CLUB_PRIZE_NOTICE).toContain('A Apple não patrocina');
  });

  it('nenhum texto tem travessão nem meia-risca', () => {
    expect(FAN_CLUB_PRIZE_NOTICE).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('o nome do fã-clube (decisão 10)', () => {
  it('3 e 40 valem, limpos', () => {
    expect(checkClubName('  Abc  ')).toEqual({ ok: true, name: 'Abc' });
    expect(checkClubName('a'.repeat(40))).toEqual({ ok: true, name: 'a'.repeat(40) });
  });

  it('2, 41, só espaços e caractere invisível: format', () => {
    for (const raw of ['ab', 'a'.repeat(41), '     ', 'Netto\u2800Fãs', 'Netto\nFãs']) {
      expect(checkClubName(raw), JSON.stringify(raw)).toEqual({ ok: false, reason: 'format' });
    }
  });

  it('"oficial" inteira, em qualquer caixa, com acento, homóglifo ou letras soltas: official', () => {
    for (const raw of [
      'Fã-clube Oficial do Netto',
      'OFICIAL Netto',
      'Netto ofícial',
      'Netto \u039Fficial',
      'Netto o f i c i a l',
      'Netto oficiaaal',
    ]) {
      expect(hasOfficialWord(raw), raw).toBe(true);
      expect(checkClubName(raw), raw).toEqual({ ok: false, reason: 'official' });
    }
    for (const raw of ['Netto oficialmente', 'fãclubeoficial', 'Netto Ofício']) {
      expect(hasOfficialWord(raw), raw).toBe(false);
    }
  });

  it('o termo barrado pelo filtro, também como trecho: not_allowed', () => {
    expect(checkClubName('Netto Pepino')).toEqual({ ok: false, reason: 'not_allowed' });
    expect(checkClubName('Turma Berinjelada do Netto')).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
  });
});

describe('o corpo da candidatura (34.3 e 34.5)', () => {
  it('limpo, com as redes normalizadas', () => {
    expect(
      parseApplication(
        body({
          name: '  Netto de Coração ',
          instagram: 'https://instagram.com/Camila.Teste.Up',
          tiktok: '@camila.teste.up',
          pitch: `  ${PITCH}  \r\n\r\n\r\n  Levo a turma aos shows.  `,
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        artistId: 'nettobrito',
        name: 'Netto de Coração',
        instagram: 'camila.teste.up',
        tiktok: 'camila.teste.up',
        whatsapp: '+5575991234567',
        pitch: `${PITCH}\n\nLevo a turma aos shows.`,
      },
    });
  });

  it('o WhatsApp normalizado pelo parseWhatsapp do contato do fã: com e sem o +55', () => {
    for (const whatsapp of ['75991234567', '+55 75 99123-4567', '55 (75) 99123-4567']) {
      expect(parseApplication(body({ whatsapp })), whatsapp).toMatchObject({
        ok: true,
        value: { whatsapp: '+5575991234567' },
      });
    }
  });

  it('as chaves do corpo, com o WhatsApp do contato do fã (decisão 14)', () => {
    expect(APPLICATION_KEYS).toEqual([
      'artistId',
      'name',
      'instagram',
      'tiktok',
      'whatsapp',
      'pitch',
      'adult',
      'rulesVersion',
    ]);
  });

  it('malformado: o campo, para o 400 invalid_request', () => {
    expect(parseApplication(undefined)).toEqual({ ok: false, field: 'body' });
    expect(parseApplication([body()])).toEqual({ ok: false, field: 'body' });
    expect(parseApplication(body({ photo: 'x' }))).toEqual({ ok: false, field: 'photo' });
    expect(parseApplication(JSON.parse('{"__proto__": {"a": 1}}'))).toEqual({
      ok: false,
      field: '__proto__',
    });
    expect(parseApplication(body({ artistId: 'Netto Brito' }))).toEqual({
      ok: false,
      field: 'artistId',
    });
    expect(parseApplication(body({ name: 7 }))).toEqual({ ok: false, field: 'name' });
    expect(parseApplication(body({ pitch: null }))).toEqual({ ok: false, field: 'pitch' });
    expect(parseApplication(body({ instagram: 7 }))).toEqual({ ok: false, field: 'instagram' });
    expect(parseApplication(body({ adult: 'sim' }))).toEqual({ ok: false, field: 'adult' });
    for (const whatsapp of [75991234567, undefined, null]) {
      expect(parseApplication(body({ whatsapp })), String(whatsapp)).toEqual({
        ok: false,
        field: 'whatsapp',
      });
    }
    expect(parseApplication(body({ rulesVersion: undefined }))).toEqual({
      ok: false,
      field: 'rulesVersion',
    });
  });

  it('fora da regra: fan_club_invalid com o campo e o motivo, na ordem de 34.5', () => {
    const cases: [Record<string, unknown>, Record<string, unknown>][] = [
      [{ name: 'ab' }, { field: 'name', reason: 'format' }],
      [{ name: 'Netto Oficial' }, { field: 'name', reason: 'official' }],
      [{ name: 'Netto Pepino' }, { field: 'name', reason: 'not_allowed' }],
      [
        { name: 'ab', pitch: 'curto' },
        { field: 'name', reason: 'format' },
      ],
      [{ pitch: 'a'.repeat(19) }, { field: 'pitch', reason: 'format' }],
      [{ pitch: 'a'.repeat(1001) }, { field: 'pitch', reason: 'format' }],
      [{ pitch: `${PITCH} abacaxi` }, { field: 'pitch', reason: 'not_allowed' }],
      [{ instagram: 'https://golpe.example/camila' }, { field: 'instagram', reason: 'format' }],
      [{ tiktok: 'berinjela.camila' }, { field: 'tiktok', reason: 'not_allowed' }],
      // O celular brasileiro com o DDD e o 9 (a regra da UP-66, seção 35, decisão 3).
      [{ whatsapp: '' }, { field: 'whatsapp', reason: 'format' }],
      [{ whatsapp: '(75) 3221-4567' }, { field: 'whatsapp', reason: 'format' }],
      [{ whatsapp: '99123-4567' }, { field: 'whatsapp', reason: 'format' }],
      [{ whatsapp: '+1 415 555 0100' }, { field: 'whatsapp', reason: 'format' }],
      [{ whatsapp: '(75) 99123-45678' }, { field: 'whatsapp', reason: 'format' }],
      [{ whatsapp: 'zap 75991234567' }, { field: 'whatsapp', reason: 'format' }],
      [
        { whatsapp: '(75) 3221-4567', adult: false },
        { field: 'whatsapp', reason: 'format' },
      ],
      [
        { instagram: null, tiktok: '' },
        { field: 'socials', reason: 'format' },
      ],
      [{ instagram: undefined }, { field: 'socials', reason: 'format' }],
      [{ adult: false }, { field: 'adult', reason: 'format' }],
      [{ rulesVersion: 'termos-2026-09' }, { field: 'rulesVersion', reason: 'format' }],
    ];
    for (const [extra, details] of cases) {
      const error = errorOf(() => parseApplication(body(extra)));
      expect(error.reason, JSON.stringify(extra)).toBe('fan_club_invalid');
      expect(error.details).toEqual(details);
    }
  });

  it('a escada da ordem: com tudo errado, cada campo só aparece depois de os de antes ficarem certos', () => {
    let extra: Record<string, unknown> = {
      name: 'ab',
      pitch: 'curto',
      instagram: null,
      tiktok: '',
      whatsapp: '(75) 3221-4567',
      adult: false,
      rulesVersion: 'termos-2026-09',
    };
    const ladder: [string, Record<string, unknown>][] = [
      ['name', { name: 'Netto de Coração' }],
      ['pitch', { pitch: PITCH }],
      ['socials', { instagram: 'camila.teste.up', tiktok: null }],
      ['whatsapp', { whatsapp: '(75) 99123-4567' }],
      ['adult', { adult: true }],
      ['rulesVersion', { rulesVersion: FAN_CLUB_RULES_VERSION }],
    ];
    for (const [field, fix] of ladder) {
      expect(errorOf(() => parseApplication(body(extra))).details, field).toEqual({
        field,
        reason: 'format',
      });
      extra = { ...extra, ...fix };
    }
    expect(parseApplication(body(extra)).ok).toBe(true);
  });

  it('o pitch de 20 e de 1.000 valem', () => {
    expect(parseApplication(body({ pitch: 'a'.repeat(20) })).ok).toBe(true);
    expect(parseApplication(body({ pitch: 'a'.repeat(1000) })).ok).toBe(true);
  });
});

describe('a candidatura de novo (34.5)', () => {
  it('a primeira é a rodada 1', () => {
    expect(applicationTurn(null, null, NOW)).toEqual({ ok: true, round: 1 });
  });

  it('as recusas, na ordem: encerrado, pendente, com fã-clube, prazo e rodadas', () => {
    expect(
      applicationTurn(application({ closedByStaff: true, status: 'pending' }), null, NOW),
    ).toEqual({ ok: false, refusal: 'not_allowed' });
    expect(applicationTurn(application({ status: 'pending' }), null, NOW)).toEqual({
      ok: false,
      refusal: 'already_applied',
    });
    for (const status of ['active', 'paused'] as const) {
      expect(
        applicationTurn(application({ status: 'approved', clubId: 'clube1' }), status, NOW),
      ).toEqual({ ok: false, refusal: 'has_fan_club' });
    }
    const canReapplyAt = NOW + DAY_MS;
    expect(applicationTurn(application({ canReapplyAt }), null, NOW)).toEqual({
      ok: false,
      refusal: 'cooldown',
      details: { canReapplyAt: new Date(canReapplyAt).toISOString() },
    });
    expect(applicationTurn(application({ round: 3 }), null, NOW)).toEqual({
      ok: false,
      refusal: 'too_many_rounds',
    });
  });

  it('a rodada: a mesma depois de desistir, mais 1 depois da recusa, 1 depois do encerramento a pedido', () => {
    expect(applicationTurn(application({ status: 'withdrawn', round: 2 }), null, NOW)).toEqual({
      ok: true,
      round: 2,
    });
    expect(applicationTurn(application({ round: 2, canReapplyAt: NOW }), null, NOW)).toEqual({
      ok: true,
      round: 3,
    });
    expect(
      applicationTurn(
        application({ status: 'approved', round: 0, clubId: 'clube1', canReapplyAt: NOW - 1 }),
        'closed',
        NOW,
      ),
    ).toEqual({ ok: true, round: 1 });
  });

  it('o canReapplyAt da recusa: 30 dias, e nenhum na 3ª rodada', () => {
    expect(FAN_CLUB_REAPPLY_MS).toBe(30 * DAY_MS);
    expect(reapplyAfterRejection(1, NOW)).toBe(NOW + 30 * DAY_MS);
    expect(reapplyAfterRejection(2, NOW)).toBe(NOW + 30 * DAY_MS);
    expect(reapplyAfterRejection(3, NOW)).toBeNull();
  });

  it('o history guarda as últimas decisões, até o teto', () => {
    const item = (round: number): ApplicationHistoryItem => ({
      round,
      decision: 'rejected',
      reason: 'other',
      at: NOW + round,
    });
    let history = [item(1)];
    for (let index = 2; index <= FAN_CLUB_HISTORY_MAX + 2; index++) {
      history = withHistory(history, item(index));
    }
    expect(history).toHaveLength(FAN_CLUB_HISTORY_MAX);
    expect(history[0]!.round).toBe(3);
    expect(history.at(-1)!.round).toBe(FAN_CLUB_HISTORY_MAX + 2);
  });
});

describe('a leitura dos documentos', () => {
  it('a candidatura estranha vale retirada, sem rodada', () => {
    expect(applicationRecord('uid', { status: 'outro', round: -1, history: 'x' })).toMatchObject({
      status: 'withdrawn',
      round: 0,
      history: [],
      clubId: null,
      closedByStaff: false,
    });
  });

  it('o fã-clube estranho vale encerrado, sem destaque', () => {
    expect(fanClubRecord('c1', { status: 'outro', featured: 'sim', postCount: -3 })).toMatchObject({
      id: 'c1',
      status: 'closed',
      featured: false,
      postCount: 0,
      ownerUid: null,
      followers: 0,
    });
  });

  it('o fã-clube lê os seguidores da cópia e as cópias do gestor', () => {
    expect(
      fanClubRecord('c1', {
        status: 'active',
        counts: { followers: 12, at: null },
        ownerName: 'Camila',
        ownerUsername: 'camilarib',
        ownerPhotoURL: '',
      }),
    ).toMatchObject({
      followers: 12,
      ownerName: 'Camila',
      ownerUsername: 'camilarib',
      ownerPhotoURL: null,
    });
  });

  it('a publicação: com a mídia é foto, sem ela é texto; o status estranho vale tirada do ar', () => {
    const media = {
      photo: {
        url: 'https://f/p',
        path: 'fanClubMedia/u/club-photo-abcdefgh.jpg',
        width: 1080,
        height: 1350,
      },
      thumb: {
        url: 'https://f/t',
        path: 'fanClubMedia/u/club-thumb-abcdefgh.jpg',
        width: 480,
        height: 600,
      },
    };
    const photo = fanClubPostRecord('p1', {
      clubId: 'c1',
      artistId: 'nettobrito',
      authorUid: 'u',
      text: 'Oi',
      media,
      status: 'pending',
      rejectReason: 'quality',
      submittedAt: { toMillis: () => NOW },
    });
    expect(photo).toMatchObject({ kind: 'photo', status: 'pending', submittedAt: NOW, media });
    expect(postMediaPaths(photo)).toEqual([media.photo.path, media.thumb.path]);
    const odd = fanClubPostRecord('p2', { status: 'apagada', media: { photo: media.photo } });
    expect(odd).toMatchObject({ kind: 'text', status: 'removed', media: null, rejectReason: null });
    expect(postMediaPaths(odd)).toEqual([]);
  });
});

describe('a publicação (decisões 11, 15 e 16)', () => {
  it('os tetos: 3 em análise, 5 por dia, 10 vagas por dia, 10 min de vaga', () => {
    expect(FAN_CLUB_PENDING_MAX).toBe(3);
    expect(FAN_CLUB_POSTS_PER_DAY).toBe(5);
    expect(FAN_CLUB_UPLOADS_PER_DAY).toBe(10);
    expect(FAN_CLUB_UPLOAD_SLOT_MS).toBe(10 * 60_000);
    expect(CLUB_PHOTO_LIMITS).toEqual({ maxBytes: 2 * 1024 * 1024, maxSide: 1350 });
    expect(CLUB_THUMB_LIMITS).toEqual({ maxBytes: 300 * 1024, maxSide: 600 });
  });

  it('o texto limpo, de 1 a 1.000, com ou sem foto', () => {
    expect(parsePost({ text: '  Que show!  ', photo: false })).toEqual({
      ok: true,
      value: { text: 'Que show!', photo: false },
    });
    expect(parsePost({ text: 'a', photo: true })).toMatchObject({ ok: true });
    expect(parsePost({ text: 'a'.repeat(1_000), photo: false })).toMatchObject({ ok: true });
  });

  it('malformado: o campo, para o 400 invalid_request', () => {
    expect(parsePost(undefined)).toEqual({ ok: false, field: 'body' });
    expect(parsePost([])).toEqual({ ok: false, field: 'body' });
    expect(parsePost({ text: 'Oi', photo: false, media: {} })).toEqual({
      ok: false,
      field: 'media',
    });
    expect(parsePost({ photo: false })).toEqual({ ok: false, field: 'text' });
    expect(parsePost({ text: 'Oi' })).toEqual({ ok: false, field: 'photo' });
    expect(parsePost({ text: 'Oi', photo: 1 })).toEqual({ ok: false, field: 'photo' });
  });

  it('fora da regra: fan_club_invalid no texto (format e o filtro, fanClubPost)', () => {
    for (const text of ['', '   ', '\u200b', 'a'.repeat(1_001)]) {
      expect(errorOf(() => parsePost({ text, photo: false })).details).toEqual({
        field: 'text',
        reason: 'format',
      });
    }
    expect(errorOf(() => parsePost({ text: 'Que pepino', photo: false })).details).toEqual({
      field: 'text',
      reason: 'not_allowed',
    });
  });

  it('o novo aceite: a versão do servidor; a outra é fan_club_invalid', () => {
    expect(parseRulesAcceptance({ rulesVersion: FAN_CLUB_RULES_VERSION })).toEqual({ ok: true });
    expect(parseRulesAcceptance(null)).toEqual({ ok: false, field: 'body' });
    expect(parseRulesAcceptance({})).toEqual({ ok: false, field: 'rulesVersion' });
    expect(parseRulesAcceptance({ rulesVersion: 2 })).toEqual({
      ok: false,
      field: 'rulesVersion',
    });
    expect(parseRulesAcceptance({ rulesVersion: FAN_CLUB_RULES_VERSION, x: 1 })).toEqual({
      ok: false,
      field: 'x',
    });
    expect(
      errorOf(() => parseRulesAcceptance({ rulesVersion: 'regulamento-2027' })).details,
    ).toEqual({ field: 'rulesVersion', reason: 'format' });
  });

  it('a vaga: os dois nomes de um id, na pasta do gestor, e a leitura deles', () => {
    expect(fanClubMediaFolder('uidCamila')).toBe('fanClubMedia/uidCamila/');
    const names = slotFileNames('9b2c0a1e-1111-4222-8333-444455556666');
    expect(names).toEqual({
      photo: 'club-photo-9b2c0a1e-1111-4222-8333-444455556666.jpg',
      thumb: 'club-thumb-9b2c0a1e-1111-4222-8333-444455556666.jpg',
    });
    expect(slotNamesOf([names.photo, names.thumb])).toEqual(names);
    expect(slotNamesOf([names.thumb, names.photo])).toBeNull();
    expect(slotNamesOf([names.photo])).toBeNull();
    expect(slotNamesOf(['club-photo-a.jpg', names.thumb])).toBeNull();
    expect(slotNamesOf('x')).toBeNull();
  });

  it('a miniatura com a proporção da foto, com a folga do arredondamento', () => {
    expect(sameProportion({ width: 1080, height: 1350 }, { width: 480, height: 600 })).toBe(true);
    expect(sameProportion({ width: 1080, height: 1350 }, { width: 480, height: 601 })).toBe(true);
    expect(sameProportion({ width: 1080, height: 1350 }, { width: 480, height: 480 })).toBe(false);
    expect(sameProportion({ width: 1080, height: 1350 }, { width: 600, height: 480 })).toBe(false);
    expect(sameProportion({ width: 0, height: 1350 }, { width: 480, height: 600 })).toBe(false);
  });

  it('a denúncia: uma por fã e publicação', () => {
    expect(fanClubReportId('uidBia', 'pub1')).toBe('uidBia_pub1');
  });

  it('os 404 saem sem detalhes', () => {
    expect(new FanClubError('fan_club_not_found').details).toBeUndefined();
  });
});

describe('as caixas por artista (decisão 9)', () => {
  it('ausentes, seguem o imageRightsConfirmed; só o false gravado desliga', () => {
    expect(fanClubBoxes({ imageRightsConfirmed: true })).toEqual({
      enabled: true,
      photosAllowed: true,
    });
    expect(fanClubBoxes({ imageRightsConfirmed: false })).toEqual({
      enabled: false,
      photosAllowed: false,
    });
    expect(fanClubBoxes(undefined)).toEqual({ enabled: false, photosAllowed: false });
    expect(
      fanClubBoxes({ imageRightsConfirmed: true, fanClubs: { photosAllowed: false } }),
    ).toEqual({ enabled: true, photosAllowed: false });
    expect(fanClubBoxes({ imageRightsConfirmed: true, fanClubs: { enabled: false } })).toEqual({
      enabled: false,
      photosAllowed: true,
    });
    // O true gravado não passa por cima da falta da autorização de imagem.
    expect(fanClubBoxes({ imageRightsConfirmed: false, fanClubs: { enabled: true } })).toEqual({
      enabled: false,
      photosAllowed: false,
    });
  });

  it('o valor do diálogo: o gravado, ou o imageRightsConfirmed', () => {
    expect(fanClubBoxValue({ imageRightsConfirmed: true }, 'enabled')).toBe(true);
    expect(fanClubBoxValue({ imageRightsConfirmed: false }, 'enabled')).toBe(false);
    expect(
      fanClubBoxValue({ imageRightsConfirmed: false, fanClubs: { enabled: true } }, 'enabled'),
    ).toBe(true);
    expect(
      fanClubBoxValue(
        { imageRightsConfirmed: true, fanClubs: { photosAllowed: false } },
        'photosAllowed',
      ),
    ).toBe(false);
  });
});

describe('o Destaque (decisão 35)', () => {
  it('amanhã e 31 dias valem; hoje, 32 dias e a data que não existe, não (o dia de São Paulo)', () => {
    expect(parseFeaturedUntil('2026-10-20', NOW)).toBe('2026-10-20');
    expect(parseFeaturedUntil('2026-11-19', NOW)).toBe('2026-11-19');
    for (const value of ['2026-10-19', '2026-11-20', '2026-02-30', '20/10/2026', 20, null]) {
      expect(parseFeaturedUntil(value, NOW), String(value)).toBeNull();
    }
    // 23:30 de 19/10 em São Paulo já é 20/10 em UTC: amanhã continua 20/10.
    const lateNight = Date.parse('2026-10-20T02:30:00.000Z');
    expect(parseFeaturedUntil('2026-10-20', lateNight)).toBe('2026-10-20');
    expect(parseFeaturedUntil('2026-10-19', lateNight)).toBeNull();
  });

  it('o destaque vale até o fim do dia do prazo', () => {
    expect(isFeaturedNow({ featured: true, featuredUntil: '2026-10-19' }, NOW)).toBe(true);
    expect(isFeaturedNow({ featured: true, featuredUntil: '2026-10-18' }, NOW)).toBe(false);
    expect(isFeaturedNow({ featured: false, featuredUntil: '2026-10-30' }, NOW)).toBe(false);
    expect(isFeaturedNow({ featured: true, featuredUntil: null }, NOW)).toBe(false);
  });
});
