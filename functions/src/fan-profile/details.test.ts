import { describe, expect, it } from 'vitest';

import {
  BIO_MAX,
  BIO_MAX_LINES,
  editableProfileOf,
  FAN_CITY_MAX,
  GENDERS,
  isSocialHandle,
  normalizeSocialHandle,
  parseProfileChanges,
  profileDiff,
  profileUpdateOf,
  publicProfileOf,
  SOCIAL_INPUT_MAX,
  SOCIAL_NETWORKS,
  socialsOf,
  type SocialNetwork,
} from './details';
import { ProfileEditError } from './model';

// Os campos novos do perfil (seção 28): as redes (a mesma tabela de
// src/domains/profile/__tests__/details.test.ts, no app: mudou uma, mude a
// outra), o corpo do PUT /me/profile, a diferença contra o perfil guardado e
// as duas respostas.

const UID = 'Kq3vZ8wQb1TnUe0aRk5pL2mXy7Fd';

describe('constantes', () => {
  it('os limites, os gêneros e as redes na ordem da tela', () => {
    expect(BIO_MAX).toBe(200);
    expect(BIO_MAX_LINES).toBe(6);
    expect(FAN_CITY_MAX).toBe(80);
    expect(SOCIAL_INPUT_MAX).toBe(300);
    expect(GENDERS).toEqual(['woman', 'man', 'nonbinary', 'undisclosed']);
    expect(SOCIAL_NETWORKS).toEqual(['instagram', 'tiktok', 'linkedin', 'x']);
  });
});

const FORMAT = { problem: 'format' } as const;
const HOST = { problem: 'host' } as const;
type Expected = string | null | typeof FORMAT | typeof HOST;

/** A tabela das redes: o que o fã digita ou cola e o usuário guardado (ou a recusa). */
const SOCIAL_CASES: [SocialNetwork, string, Expected][] = [
  // Instagram.
  ['instagram', 'camila.teste.up', 'camila.teste.up'],
  ['instagram', '@camila.teste.up', 'camila.teste.up'],
  ['instagram', '  @Camila.Teste.Up  ', 'camila.teste.up'],
  ['instagram', 'https://www.instagram.com/camila.teste.up/', 'camila.teste.up'],
  ['instagram', 'http://instagram.com/camila.teste.up', 'camila.teste.up'],
  ['instagram', 'instagram.com/camila.teste.up?igsh=abc123', 'camila.teste.up'],
  ['instagram', 'www.instagram.com/camila.teste.up/#top', 'camila.teste.up'],
  ['instagram', 'HTTPS://M.INSTAGRAM.COM/Camila.Teste.Up', 'camila.teste.up'],
  ['instagram', 'https://www.instagram.com/p/C1a2b3c4d5/', FORMAT],
  // As páginas da rede que cabem no padrão: coladas da barra de endereço ou digitadas.
  ['instagram', 'https://www.instagram.com/explore/', FORMAT],
  ['instagram', 'instagram.com/direct', FORMAT],
  ['instagram', 'https://instagram.com/reels/', FORMAT],
  ['instagram', 'https://www.instagram.com/accounts', FORMAT],
  ['instagram', 'explore', FORMAT],
  ['instagram', '@Explore', FORMAT],
  ['instagram', 'explorer', 'explorer'],
  ['instagram', 'camila.explore', 'camila.explore'],
  ['instagram', 'https://instagram.com', FORMAT],
  ['instagram', 'instagram.com/', FORMAT],
  ['instagram', 'https://evil.instagram.com/camila.teste.up', FORMAT],
  ['instagram', 'https://www.tiktok.com/@camila.teste.up', HOST],
  ['instagram', 'https://golpe.example/camila.teste.up', HOST],
  ['instagram', 'golpe.example/camila', HOST],
  ['instagram', '.camila', FORMAT],
  ['instagram', 'camila.', FORMAT],
  ['instagram', 'camila..teste', FORMAT],
  ['instagram', 'camila teste', FORMAT],
  ['instagram', '@', FORMAT],
  ['instagram', 'a'.repeat(30), 'a'.repeat(30)],
  ['instagram', 'a'.repeat(31), FORMAT],
  ['instagram', '', null],
  ['instagram', '   ', null],
  ['instagram', 'a'.repeat(SOCIAL_INPUT_MAX + 1), FORMAT],
  // TikTok.
  ['tiktok', 'camila.teste.up', 'camila.teste.up'],
  ['tiktok', '@Camila.Teste.Up', 'camila.teste.up'],
  ['tiktok', 'https://www.tiktok.com/@camila.teste.up?lang=pt-BR', 'camila.teste.up'],
  ['tiktok', 'm.tiktok.com/@camila.teste.up/', 'camila.teste.up'],
  ['tiktok', 'https://www.tiktok.com/camila.teste.up', FORMAT],
  ['tiktok', 'https://www.tiktok.com/@camila.teste.up/video/7300000000000000000', FORMAT],
  ['tiktok', 'https://vm.tiktok.com/ZMabc123/', FORMAT],
  ['tiktok', 'https://www.instagram.com/camila.teste.up', HOST],
  ['tiktok', 'c', FORMAT],
  ['tiktok', 'camila.', FORMAT],
  ['tiktok', 'a'.repeat(24), 'a'.repeat(24)],
  ['tiktok', 'a'.repeat(25), FORMAT],
  // LinkedIn: o endereço depois de /in/, com as letras latinas acentuadas.
  ['linkedin', 'thalita-teste-imagineup', 'thalita-teste-imagineup'],
  ['linkedin', 'https://www.linkedin.com/in/thalita-teste-imagineup/', 'thalita-teste-imagineup'],
  ['linkedin', 'https://br.linkedin.com/in/jo%C3%A3o-teste', 'joão-teste'],
  ['linkedin', 'linkedin.com/in/Jo%C3%A3o-Teste?trk=public_profile', 'joão-teste'],
  ['linkedin', 'joão-teste', 'joão-teste'],
  ['linkedin', 'joão-teste', 'joão-teste'],
  ['linkedin', 'Žofia-Teste', 'žofia-teste'],
  ['linkedin', 'https://www.linkedin.com/company/imagine-music', FORMAT],
  ['linkedin', 'https://www.linkedin.com/in/jo%E3o-teste', FORMAT],
  ['linkedin', 'https://www.linkedin.com/in/%ZZteste', FORMAT],
  ['linkedin', 'https://x.com/thalitatesteup', HOST],
  ['linkedin', 'ab', FORMAT],
  ['linkedin', 'thalitaㅤteste', FORMAT],
  ['linkedin', 'ᅟthalita-teste', FORMAT],
  ['linkedin', 'thalita-testeᅠ', FORMAT],
  ['linkedin', 'thalitaﾠteste', FORMAT],
  ['linkedin', 'שלום-teste', FORMAT],
  ['linkedin', 'ｔｈａｌｉｔａ', FORMAT],
  ['linkedin', 'thalita÷teste', FORMAT],
  ['linkedin', 'a'.repeat(100), 'a'.repeat(100)],
  ['linkedin', 'a'.repeat(101), FORMAT],
  // X.
  ['x', 'thalitatesteup', 'thalitatesteup'],
  ['x', '@ThalitaTesteUp', 'thalitatesteup'],
  ['x', 'https://x.com/thalitatesteup', 'thalitatesteup'],
  ['x', 'https://twitter.com/thalitatesteup?s=21&t=abc', 'thalitatesteup'],
  ['x', 'https://mobile.twitter.com/thalitatesteup', 'thalitatesteup'],
  ['x', 'www.x.com/thalitatesteup/', 'thalitatesteup'],
  ['x', 'https://x.com/thalitatesteup/status/1800000000000000000', FORMAT],
  ['x', 'https://www.linkedin.com/in/thalita-teste', HOST],
  ['x', 'thalita.teste', FORMAT],
  ['x', 'twitter.com', FORMAT],
  ['x', 'https://x.com/home', FORMAT],
  ['x', 'x.com/explore', FORMAT],
  ['x', 'https://twitter.com/notifications/', FORMAT],
  ['x', 'https://x.com/i', FORMAT],
  ['x', 'https://mobile.twitter.com/settings', FORMAT],
  ['x', 'logout', FORMAT],
  ['x', '@Home', FORMAT],
  ['x', 'homes', 'homes'],
  ['x', 'home_up', 'home_up'],
  ['x', 'a'.repeat(15), 'a'.repeat(15)],
  ['x', 'a'.repeat(16), FORMAT],
];

describe('normalizeSocialHandle', () => {
  it.each(SOCIAL_CASES)('%s: %j', (network, raw, expected) => {
    const result = normalizeSocialHandle(network, raw);
    if (expected !== null && typeof expected === 'object') {
      expect(result).toEqual({ ok: false, reason: expected.problem });
    } else {
      expect(result).toEqual({ ok: true, handle: expected });
    }
  });

  it('o domínio de uma rede sem barra também é link, mesmo no formato de um usuário do Instagram', () => {
    // O padrão sozinho (isSocialHandle) aceitaria "instagram.com"; o link montado
    // dele teria o domínio fixo do mesmo jeito.
    expect(normalizeSocialHandle('instagram', 'instagram.com')).toEqual({
      ok: false,
      reason: 'format',
    });
    expect(normalizeSocialHandle('instagram', 'camila.x.com')).toEqual({
      ok: false,
      reason: 'host',
    });
  });
});

describe('isSocialHandle', () => {
  it.each(SOCIAL_CASES)('%s: %j', (network, raw, expected) => {
    // Só o usuário já guardado (normalizado) passa: o link, a arroba e as maiúsculas não.
    expect(isSocialHandle(network, raw)).toBe(typeof expected === 'string' && raw === expected);
    if (typeof expected === 'string') expect(isSocialHandle(network, expected)).toBe(true);
  });

  it('o que não é texto não passa', () => {
    for (const value of [null, undefined, 42, ['camila'], { handle: 'camila' }]) {
      expect(isSocialHandle('instagram', value)).toBe(false);
    }
  });
});

/** O campo do 400 `invalid_request` (o pedido malformado). */
const fieldOf = (body: unknown): string | null => {
  const parsed = parseProfileChanges(body);
  return parsed.ok ? null : parsed.field;
};

/** A recusa lançada (`profile_invalid` ou `username_invalid`), com o código e os detalhes. */
function refusalOf(body: unknown): { reason: string; details: unknown } {
  try {
    parseProfileChanges(body);
  } catch (error) {
    if (error instanceof ProfileEditError) return { reason: error.reason, details: error.details };
    throw error;
  }
  throw new Error('deveria ter recusado');
}

const valueOf = (body: unknown) => {
  const parsed = parseProfileChanges(body);
  if (!parsed.ok) throw new Error(`recusou ${parsed.field}`);
  return parsed.value;
};

describe('parseProfileChanges: o pedido malformado (400 invalid_request)', () => {
  it.each([
    ['corpo que não é objeto', null, 'body'],
    ['texto', 'camila', 'body'],
    ['lista', [{ displayName: 'Camila' }], 'body'],
    ['número', 42, 'body'],
    ['sem nenhuma chave', {}, 'body'],
    [
      'chave desconhecida',
      { displayName: 'Camila', photoURL: 'https://golpe.example' },
      'photoURL',
    ],
    ['__proto__ no topo', JSON.parse('{"__proto__": {"bio": "x"}}'), '__proto__'],
    ['constructor no topo', JSON.parse('{"constructor": 1}'), 'constructor'],
    ['updatedAt', { updatedAt: 1 }, 'updatedAt'],
    ['nome que não é texto', { displayName: 42 }, 'displayName'],
    ['nome null', { displayName: null }, 'displayName'],
    ['@ que não é texto', { username: 7 }, 'username'],
    ['@ cru acima de 64', { username: 'a'.repeat(65) }, 'username'],
    ['bio que não é texto', { bio: 42 }, 'bio'],
    ['cidade lista', { city: ['Irará'] }, 'city'],
    ['gênero número', { gender: 1 }, 'gender'],
    ['privada como texto', { privateAccount: 'true' }, 'privateAccount'],
    ['privada null', { privateAccount: null }, 'privateAccount'],
    ['redes null', { socials: null }, 'socials'],
    ['redes como texto', { socials: 'camila' }, 'socials'],
    ['redes como lista', { socials: ['camila'] }, 'socials'],
    ['redes vazias', { socials: {} }, 'socials'],
    ['rede desconhecida', { socials: { facebook: 'camila' } }, 'socials.facebook'],
    [
      '__proto__ nas redes',
      { socials: JSON.parse('{"__proto__": "camila"}') },
      'socials.__proto__',
    ],
    [
      'constructor nas redes',
      { socials: JSON.parse('{"constructor": "camila"}') },
      'socials.constructor',
    ],
    ['rede que não é texto', { socials: { x: 42 } }, 'socials.x'],
    ['rede objeto', { socials: { instagram: { handle: 'camila' } } }, 'socials.instagram'],
  ])('%s', (_, body, field) => {
    expect(fieldOf(body)).toBe(field);
  });
});

describe('parseProfileChanges: os campos fora da regra', () => {
  it.each([
    ['nome vazio', { displayName: '' }, 'displayName', 'empty'],
    ['nome só de espaços', { displayName: '   ' }, 'displayName', 'empty'],
    ['nome com 61', { displayName: 'x'.repeat(61) }, 'displayName', 'too_long'],
    [
      'nome com 62 em UTF-16 (31 emoji)',
      { displayName: '😀'.repeat(31) },
      'displayName',
      'too_long',
    ],
    ['nome invisível', { displayName: 'ㅤ' }, 'displayName', 'invisible'],
    ['nome com quebra de linha', { displayName: 'Camila\nRibeiro' }, 'displayName', 'invisible'],
    ['nome com espaço de largura zero', { displayName: 'Cami​la' }, 'displayName', 'invisible'],
    ['bio com 201', { bio: 'a'.repeat(BIO_MAX + 1) }, 'bio', 'too_long'],
    ['bio com 7 linhas', { bio: 'a\nb\nc\nd\ne\nf\ng' }, 'bio', 'too_many_lines'],
    ['bio com uma linha invisível', { bio: 'oi\nㅤ\ntchau' }, 'bio', 'invisible'],
    ['cidade com 81', { city: 'x'.repeat(FAN_CITY_MAX + 1) }, 'city', 'too_long'],
    ['cidade em duas linhas', { city: 'Irará BA' }, 'city', 'invisible'],
    ['gênero fora da lista', { gender: 'other' }, 'gender', 'unknown'],
    ['gênero em maiúsculas', { gender: 'Woman' }, 'gender', 'unknown'],
    [
      'link de outra rede',
      { socials: { instagram: 'https://www.tiktok.com/@camila' } },
      'socials.instagram',
      'host',
    ],
    ['X com 16', { socials: { x: 'a'.repeat(16) } }, 'socials.x', 'format'],
    ['rede crua com 301', { socials: { linkedin: 'a'.repeat(301) } }, 'socials.linkedin', 'format'],
  ])('%s: profile_invalid', (_, body, field, reason) => {
    expect(refusalOf(body)).toEqual({ reason: 'profile_invalid', details: { field, reason } });
  });

  it.each([['ab'], ['camila.rib'], ['camilaribeirõ'], ['@']])(
    '@ %j fora do formato: username_invalid',
    (username) => {
      expect(refusalOf({ username })).toEqual({
        reason: 'username_invalid',
        details: { reason: 'format' },
      });
    },
  );

  it('o tipo errado vem antes da regra: o pedido malformado é invalid_request', () => {
    expect(fieldOf({ displayName: '', socials: { x: 42 } })).toBe('socials.x');
  });
});

describe('parseProfileChanges: o corpo limpo', () => {
  it('cada campo limpo, montado campo a campo num objeto novo', () => {
    const body = {
      displayName: '  Camila Ribeiro ',
      username: ' @CamilaRibeiro ',
      bio: '  Feira de Santana.  \n\n\n  Fã do Netto desde o primeiro show. ',
      city: ' Feira de Santana, BA ',
      gender: 'woman',
      privateAccount: false,
      socials: { instagram: 'https://www.instagram.com/camila.teste.up/', x: null, tiktok: '' },
    };
    const value = valueOf(body);
    expect(value).toEqual({
      displayName: 'Camila Ribeiro',
      username: 'camilaribeiro',
      bio: 'Feira de Santana.\n\nFã do Netto desde o primeiro show.',
      city: 'Feira de Santana, BA',
      gender: 'woman',
      privateAccount: false,
      socials: { instagram: 'camila.teste.up', tiktok: null, x: null },
    });
    expect(value).not.toBe(body);
    expect(Object.keys(value.socials!)).toEqual(['instagram', 'tiktok', 'x']);
  });

  it('o nome no limite (60 em UTF-16, também com emoji), a bio no limite e as 6 linhas passam', () => {
    expect(valueOf({ displayName: 'x'.repeat(60) }).displayName).toBe('x'.repeat(60));
    expect(valueOf({ displayName: '😀'.repeat(30) }).displayName).toBe('😀'.repeat(30));
    expect(valueOf({ bio: 'a'.repeat(BIO_MAX) }).bio).toBe('a'.repeat(BIO_MAX));
    expect(valueOf({ bio: 'a\nb\nc\nd\ne\nf' }).bio).toBe('a\nb\nc\nd\ne\nf');
    // As linhas vazias seguidas viram uma antes da conta: 9 linhas digitadas, 3 limpas.
    expect(valueOf({ bio: 'a\n\n\n\n\n\n\n\nb' }).bio).toBe('a\n\nb');
    expect(valueOf({ city: 'x'.repeat(FAN_CITY_MAX) }).city).toBe('x'.repeat(FAN_CITY_MAX));
  });

  it('a bio e a cidade vazias viram null; o gênero aceita null; os isolantes bidi saem', () => {
    expect(valueOf({ bio: '' })).toEqual({ bio: null });
    expect(valueOf({ bio: '  \n  ' })).toEqual({ bio: null });
    expect(valueOf({ bio: null })).toEqual({ bio: null });
    expect(valueOf({ city: '   ' })).toEqual({ city: null });
    expect(valueOf({ city: null })).toEqual({ city: null });
    expect(valueOf({ gender: null })).toEqual({ gender: null });
    expect(valueOf({ privateAccount: true })).toEqual({ privateAccount: true });
    expect(valueOf({ bio: '⁦Irará na veia⁩' })).toEqual({ bio: 'Irará na veia' });
    expect(valueOf({ city: 'Irará, BA' })).toEqual({ city: 'Irará, BA' });
  });
});

describe('profileDiff', () => {
  const stored = {
    displayName: 'Camila Ribeiro',
    username: 'camilarib',
    bio: 'Feira de Santana.',
    city: 'Feira de Santana, BA',
    gender: 'woman',
    privateAccount: true,
    socials: { instagram: 'camila.teste.up', tiktok: null, linkedin: null, x: null, extra: 'zz' },
  };

  it('o mesmo valor sai: sem diferença, um objeto vazio', () => {
    expect(
      profileDiff(stored, {
        displayName: 'Camila Ribeiro',
        username: 'camilarib',
        bio: 'Feira de Santana.',
        city: 'Feira de Santana, BA',
        gender: 'woman',
        privateAccount: true,
        socials: { instagram: 'camila.teste.up', x: null },
      }),
    ).toEqual({});
  });

  it('o que difere fica; as redes rede a rede (a igual sai, a diferente fica)', () => {
    expect(
      profileDiff(stored, {
        displayName: 'Camila R.',
        username: 'camilanova',
        bio: null,
        city: null,
        gender: 'undisclosed',
        privateAccount: false,
        socials: { instagram: 'camila.teste.up', x: 'camilatesteup' },
      }),
    ).toEqual({
      displayName: 'Camila R.',
      username: 'camilanova',
      bio: null,
      city: null,
      gender: 'undisclosed',
      privateAccount: false,
      socials: { x: 'camilatesteup' },
    });
  });

  it('o perfil antigo, sem os campos novos, vale o padrão: null e false não mudam nada', () => {
    const old = { displayName: 'Camila', username: 'camilarib', city: null };
    expect(
      profileDiff(old, {
        bio: null,
        gender: null,
        privateAccount: false,
        socials: { instagram: null, x: null },
      }),
    ).toEqual({});
    expect(profileDiff(old, { privateAccount: true })).toEqual({ privateAccount: true });
  });

  it('chave estranha e rede fora do padrão no mapa guardado valem como vazias', () => {
    const odd = { socials: { x: 'Fora Do Padrão', outra: 'zz' }, gender: 'outro' };
    expect(profileDiff(odd, { socials: { x: null }, gender: null })).toEqual({});
    expect(profileDiff({ socials: 'camila' }, { socials: { instagram: null } })).toEqual({});
  });
});

describe('profileUpdateOf', () => {
  it('as redes vão inteiras, com as quatro chaves da lista fixa, sem a chave estranha', () => {
    const fields = profileUpdateOf(
      { socials: { instagram: 'camila.teste.up', x: 'Fora Do Padrão', extra: 'zz' } },
      { socials: { tiktok: 'camila.teste.up' } },
    );
    expect(fields).toEqual({
      socials: { instagram: 'camila.teste.up', tiktok: 'camila.teste.up', linkedin: null, x: null },
    });
    expect(Object.keys(fields.socials as object)).toEqual([...SOCIAL_NETWORKS]);
  });

  it('as quatro vazias viram null; nunca o @ nem o updatedAt', () => {
    expect(
      profileUpdateOf(
        { socials: { instagram: 'camila.teste.up' } },
        { socials: { instagram: null } },
      ),
    ).toEqual({ socials: null });
    const fields = profileUpdateOf(
      {},
      {
        displayName: 'Camila',
        username: 'camilanova',
        bio: null,
        city: 'Irará, BA',
        gender: 'man',
        privateAccount: true,
      },
    );
    expect(fields).toEqual({
      displayName: 'Camila',
      bio: null,
      city: 'Irará, BA',
      gender: 'man',
      privateAccount: true,
    });
  });
});

/** Um `Timestamp` do Firestore, só com o que o perfil editável lê. */
const timestamp = (iso: string) => ({ toMillis: () => Date.parse(iso) });

describe('editableProfileOf', () => {
  it('o perfil completo, com o prazo do @ em ISO e as quatro redes', () => {
    expect(
      editableProfileOf({
        displayName: 'Camila Ribeiro',
        username: 'camilaribeiro',
        usernameChangeableAt: timestamp('2026-11-07T15:00:00.000Z'),
        bio: 'Feira de Santana.\nFã do Netto desde o primeiro show.',
        city: 'Feira de Santana, BA',
        gender: 'woman',
        privateAccount: false,
        socials: { instagram: 'camila.teste.up', tiktok: null, linkedin: null, x: null },
        searchKeys: ['cami'],
        updatedAt: timestamp('2026-10-01T00:00:00.000Z'),
      }),
    ).toEqual({
      displayName: 'Camila Ribeiro',
      username: 'camilaribeiro',
      usernameChangeableAt: '2026-11-07T15:00:00.000Z',
      bio: 'Feira de Santana.\nFã do Netto desde o primeiro show.',
      city: 'Feira de Santana, BA',
      gender: 'woman',
      privateAccount: false,
      socials: { instagram: 'camila.teste.up', tiktok: null, linkedin: null, x: null },
    });
  });

  it('o perfil antigo, sem os campos novos: o padrão; e o valor torto vira o padrão', () => {
    expect(editableProfileOf({ displayName: null, username: 'fa123456' })).toEqual({
      displayName: null,
      username: 'fa123456',
      usernameChangeableAt: null,
      bio: null,
      city: null,
      gender: null,
      privateAccount: false,
      socials: { instagram: null, tiktok: null, linkedin: null, x: null },
    });
    expect(
      editableProfileOf({
        gender: 'outro',
        privateAccount: 'sim',
        bio: 42,
        socials: { x: 'Fora Do Padrão', outra: 'zz' },
        usernameChangeableAt: '2026-11-07',
      }),
    ).toMatchObject({
      gender: null,
      privateAccount: false,
      bio: null,
      socials: { instagram: null, tiktok: null, linkedin: null, x: null },
      usernameChangeableAt: null,
    });
  });
});

describe('publicProfileOf', () => {
  const thalita = {
    displayName: 'Thalita Santos',
    username: 'thalitasan',
    photoURL: null,
    bio: 'Do arrocha ao piseiro, sigo o Netto em todo São João.\nIrará na veia.',
    city: 'Irará, BA',
    gender: 'woman',
    privateAccount: false,
    suspendedAt: null,
    searchKeys: ['tha', 'thal'],
    usernameChangeableAt: timestamp('2026-11-07T15:00:00.000Z'),
    usernameChangedAt: timestamp('2026-10-08T15:00:00.000Z'),
    photoPath: 'fans/uid/photo-abcdefgh.jpg',
    photoUpdatedAt: timestamp('2026-10-08T15:00:00.000Z'),
    updatedAt: timestamp('2026-10-01T00:00:00.000Z'),
    socials: {
      instagram: 'thalita.teste.up',
      tiktok: 'thalita.teste.up',
      linkedin: 'thalita-teste-imagineup',
      x: 'thalitatesteup',
    },
  };

  it('a completa: só foto, nome, @, bio e redes (nunca gênero, cidade, privada, suspensão nem searchKeys)', () => {
    const profile = publicProfileOf(UID, thalita, false);
    expect(profile).toEqual({
      uid: UID,
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
    expect(Object.keys(profile).sort()).toEqual(
      ['uid', 'displayName', 'username', 'photoURL', 'restricted', 'bio', 'socials'].sort(),
    );
  });

  it('a fechada: só os três, e o mesmo corpo seja qual for o resto do documento', () => {
    const closed = publicProfileOf(UID, thalita, true);
    expect(closed).toEqual({
      uid: UID,
      displayName: 'Thalita Santos',
      username: 'thalitasan',
      photoURL: null,
      restricted: true,
      bio: null,
      socials: null,
    });
    expect(publicProfileOf(UID, { ...thalita, privateAccount: true }, true)).toEqual(closed);
    expect(
      publicProfileOf(UID, { ...thalita, suspendedAt: timestamp('2026-10-08') }, true),
    ).toEqual(closed);
  });

  it('as redes vazias viram null; a rede guardada fora do padrão não sai', () => {
    expect(publicProfileOf(UID, { ...thalita, socials: null }, false).socials).toBeNull();
    expect(
      publicProfileOf(UID, { ...thalita, socials: { instagram: null, x: '' } }, false).socials,
    ).toBeNull();
    expect(
      publicProfileOf(
        UID,
        { ...thalita, socials: { instagram: 'https://golpe.example/x', x: 'thalitatesteup' } },
        false,
      ).socials,
    ).toEqual({ instagram: null, tiktok: null, linkedin: null, x: 'thalitatesteup' });
    expect(
      publicProfileOf(UID, { ...thalita, socials: { x: 'Fora Do Padrão' } }, false).socials,
    ).toBeNull();
  });

  it('o perfil antigo, sem os campos novos: sem bio e sem redes', () => {
    expect(publicProfileOf(UID, { displayName: null, username: 'fa123456' }, false)).toEqual({
      uid: UID,
      displayName: null,
      username: 'fa123456',
      photoURL: null,
      restricted: false,
      bio: null,
      socials: null,
    });
  });
});

describe('socialsOf', () => {
  it('lê o mapa pela lista fixa, sem a chave estranha e sem a rede fora do padrão', () => {
    expect(socialsOf({ x: 'thalitatesteup', outra: 'zz', instagram: 42 })).toEqual({
      instagram: null,
      tiktok: null,
      linkedin: null,
      x: 'thalitatesteup',
    });
    expect(socialsOf(undefined)).toEqual({
      instagram: null,
      tiktok: null,
      linkedin: null,
      x: null,
    });
    expect(socialsOf(['thalita'])).toEqual({
      instagram: null,
      tiktok: null,
      linkedin: null,
      x: null,
    });
  });
});
