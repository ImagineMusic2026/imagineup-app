import { describe, expect, it } from 'vitest';

import { EVENT_ID_PATTERN } from '../points/model';
import {
  classifyInvitePath,
  drawInviteCode,
  INVITE_CLAIM_WINDOW_MS,
  INVITE_CODE_ALPHABET,
  INVITE_LINKS_PER_DAY,
  INVITE_VISITS_SENT_PER_DAY,
  inviteOwnership,
  inviteUrl,
  isInviteOwner,
  isWithinClaimWindow,
  normalizeEmail,
  normalizeInviteCode,
  normalizeUtm,
  originKind,
  parseClaimBody,
  parseLinkId,
  parseVisitBody,
  personKey,
} from './model';

const NOW = Date.parse('2026-10-05T15:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const SECRET = 'segredo-de-teste';

describe('código sorteado', () => {
  it('8 caracteres, só do alfabeto sem vogal e sem 0, 1, I, L e O', () => {
    let seed = 0.123;
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let index = 0; index < 50; index += 1) {
      const code = drawInviteCode(random);
      expect(code).toMatch(/^[23456789BCDFGHJKMNPQRSTVWXYZ]{8}$/);
    }
    expect(INVITE_CODE_ALPHABET).not.toMatch(/[AEIOU01L]/);
  });

  it('com o random fixo, o mesmo código; random 1 cai na última letra', () => {
    expect(drawInviteCode(() => 0)).toBe('22222222');
    expect(drawInviteCode(() => 0)).toBe(drawInviteCode(() => 0));
    expect(drawInviteCode(() => 1)).toBe('ZZZZZZZZ');
  });

  it('o link do atalho Convidar é a base com ?ref=', () => {
    expect(inviteUrl('K7P3M9QX')).toBe('https://imagineup-painel.vercel.app/?ref=K7P3M9QX');
    expect(inviteUrl('K7P3M9QX', 'https://imagineup.app')).toBe(
      'https://imagineup.app/?ref=K7P3M9QX',
    );
  });
});

// A mesma tabela de src/domains/invites/__tests__/link.test.ts, no app: mudou
// uma, mude a outra.
describe('normalizeInviteCode (a mesma tabela do app)', () => {
  it.each([
    ['K7P3M9QX', 'K7P3M9QX'],
    ['k7p3m9qx', 'K7P3M9QX'],
    ['K7P3-M9QX', 'K7P3M9QX'],
    [' k7p3 m9qx ', 'K7P3M9QX'],
    ['camila12', 'CAMILA12'],
    ['abc_12', 'ABC_12'],
    ['ABC', 'ABC'],
  ])('%j vira %j', (raw, code) => {
    expect(normalizeInviteCode(raw)).toBe(code);
  });

  it.each([
    [''],
    ['ab'],
    ['a-b'],
    ['K7P3M9Q!'],
    ['straße'],
    ['ÇÃO123'],
    ['x'.repeat(65)],
    [null],
    [12345678],
  ])('%j não é código', (raw) => {
    expect(normalizeInviteCode(raw)).toBeNull();
  });
});

describe('chave da pessoa', () => {
  it('maiúsculas, espaço nas pontas e o + em qualquer domínio dão a mesma chave', () => {
    const base = personKey('nome@exemplo.com', 'uid-1', SECRET);
    expect(personKey(' NOME@Exemplo.com ', 'uid-2', SECRET)).toBe(base);
    expect(personKey('nome+promo@exemplo.com', 'uid-3', SECRET)).toBe(base);
    // Fora do Gmail, os pontos fazem parte do endereço.
    expect(personKey('n.ome@exemplo.com', 'uid-4', SECRET)).not.toBe(base);
  });

  it('no Gmail, sem os pontos da parte local; googlemail.com é gmail.com', () => {
    const base = personKey('nome@gmail.com', 'uid-1', SECRET);
    expect(personKey('n.o.m.e@gmail.com', 'uid-2', SECRET)).toBe(base);
    expect(personKey('Nome+1@GoogleMail.com', 'uid-3', SECRET)).toBe(base);
    expect(normalizeEmail('N.O.M.E+x@googlemail.com')).toBe('nome@gmail.com');
  });

  it('sem e-mail, é o uid; e-mail sem parte local também', () => {
    expect(personKey(null, 'abcDEF123', SECRET)).toBe('uabcDEF123');
    expect(personKey('+promo@gmail.com', 'abcDEF123', SECRET)).toBe('uabcDEF123');
    expect(normalizeEmail('sem-arroba')).toBeNull();
  });

  it('no formato do id do lançamento (`invite_visit:<chave>`) e do documento', () => {
    for (const key of [
      personKey('nome@gmail.com', 'uid', SECRET),
      personKey(null, 'abcDEF123', SECRET),
      personKey(null, 'uid com espaço/barra', SECRET),
    ]) {
      expect(key).toMatch(EVENT_ID_PATTERN);
      expect(key).not.toContain('/');
    }
    expect(personKey('nome@gmail.com', 'uid', SECRET)).toMatch(/^e[0-9a-f]{40}$/);
    expect(personKey(null, 'uid com espaço/barra', SECRET)).toMatch(/^h[0-9a-f]{40}$/);
  });

  it('a mesma com o mesmo segredo, outra com outro segredo (HMAC, e não sha256)', () => {
    expect(personKey('nome@gmail.com', 'a', SECRET)).toBe(personKey('nome@gmail.com', 'b', SECRET));
    expect(personKey('nome@gmail.com', 'a', SECRET)).not.toBe(
      personKey('nome@gmail.com', 'a', 'outro-segredo'),
    );
  });

  it('sem segredo, não calcula (configuração quebrada é erro, não chave fraca)', () => {
    expect(() => personKey('nome@gmail.com', 'a', '')).toThrow(/INVITE_KEY_SECRET/);
  });

  it('dono do código: pelo uid ou pela chave do e-mail', () => {
    const key = personKey('nome@gmail.com', 'dona', SECRET);
    const invite = { uid: 'dona', ownerKey: key };
    expect(isInviteOwner(invite, { uid: 'dona', key: 'outra' })).toBe(true);
    expect(
      isInviteOwner(invite, { uid: 'segunda', key: personKey('n.ome+1@gmail.com', 'x', SECRET) }),
    ).toBe(true);
    expect(
      isInviteOwner(invite, { uid: 'outra', key: personKey('bia@gmail.com', 'y', SECRET) }),
    ).toBe(false);
    expect(isInviteOwner({ uid: 'dona', ownerKey: null }, { uid: 'outra', key: 'x' })).toBe(false);
  });

  it('a mesma conta e a mesma pessoa noutra conta são casos separados (só a conta ouve o 409)', () => {
    const key = personKey('nome@gmail.com', 'dona', SECRET);
    const invite = { uid: 'dona', ownerKey: key };
    expect(inviteOwnership(invite, { uid: 'dona', key })).toBe('account');
    expect(inviteOwnership(invite, { uid: 'dona', key: 'outra' })).toBe('account');
    expect(
      inviteOwnership(invite, { uid: 'segunda', key: personKey('nome+1@gmail.com', 'x', SECRET) }),
    ).toBe('person');
    expect(
      inviteOwnership(invite, { uid: 'outra', key: personKey('bia@gmail.com', 'y', SECRET) }),
    ).toBeNull();
    expect(inviteOwnership({ uid: 'dona', ownerKey: null }, { uid: 'outra', key })).toBeNull();
  });
});

describe('janela do claim e tetos', () => {
  it('conta de até 7 dias vale; de 8 dias, ou sem data, não', () => {
    expect(INVITE_CLAIM_WINDOW_MS).toBe(7 * DAY_MS);
    expect(isWithinClaimWindow(NOW - 7 * DAY_MS, NOW)).toBe(true);
    expect(isWithinClaimWindow(NOW - 7 * DAY_MS - 1, NOW)).toBe(false);
    expect(isWithinClaimWindow(NOW - 8 * DAY_MS, NOW)).toBe(false);
    expect(isWithinClaimWindow(null, NOW)).toBe(false);
  });

  it('20 visitas mandadas e 30 links novos por dia', () => {
    expect(INVITE_VISITS_SENT_PER_DAY).toBe(20);
    expect(INVITE_LINKS_PER_DAY).toBe(30);
  });
});

describe('tipo do link (classifyInvitePath)', () => {
  it.each([
    ['/', 'invite', null],
    ['/c/K7P3M9QX', 'invite', null],
    ['/post/p-clipe', 'post', 'p-clipe'],
    ['/post/p-clipe/', 'post', 'p-clipe'],
    ['/post/p-clipe?aba=comentarios', 'post', 'p-clipe'],
    ['/artista/nettobrito', 'artist', 'nettobrito'],
    ['/agenda', 'agenda', null],
    ['/agenda?mes=10', 'agenda', null],
    ['/ranking', 'other', null],
    ['/post/id%20com%20espaco', 'other', null],
    ['/post/a/b', 'other', null],
    ['/post/__x__', 'other', null],
    ['/post/__p-clipe', 'post', '__p-clipe'],
    ['/artista/Netto-Brito', 'other', null],
    ['/artista/__trio__', 'other', null],
    ['/agenda/123', 'other', null],
  ])('%s é %s', (path, kind, targetId) => {
    expect(classifyInvitePath(path)).toEqual({ kind, targetId });
  });
});

describe('utm normalizado', () => {
  it.each([
    ['Instagram', 'instagram'],
    ['  WhatsApp Status ', 'whatsapp-status'],
    ['São João 2026', 'sao-joao-2026'],
    ['v1.2', 'v1.2'],
    ['2026-10-05', '2026-10-05'],
    ['--story--', 'story'],
    ['a~b_c', 'a~b_c'],
    ['_none', 'none'],
    ['__x__', 'x'],
    ['Promo!!!', 'promo'],
  ])('%j vira %j', (raw, value) => {
    expect(normalizeUtm(raw)).toBe(value);
  });

  it.each([
    ['joao.silva@gmail.com'],
    ['contato @ loja'],
    ['(71) 99999-1234'],
    ['+55 71 99999 1234'],
    ['123.456.789-09'],
    ['7199991234'],
    ['   '],
    ['@@@'],
    [''],
  ])('%j vira null (e-mail, telefone, CPF ou vazio)', (raw) => {
    expect(normalizeUtm(raw)).toBeNull();
  });

  it('até 100 caracteres, sem - na ponta depois do corte', () => {
    const value = normalizeUtm(`${'a'.repeat(99)} b`);
    expect(value).toBe('a'.repeat(99));
    expect(normalizeUtm('x'.repeat(150))).toHaveLength(100);
  });
});

describe('corpo do claim (parseClaimBody)', () => {
  const link = { path: '/post/p-clipe' };

  it('com link: código normalizado, tipo do link, os três utm e o openedAt', () => {
    expect(
      parseClaimBody(
        {
          code: 'k7p3-m9qx',
          via: 'link',
          link,
          utm: {
            source: 'Instagram',
            medium: 'story',
            campaign: 'São João',
            content: 'ana@x.com',
            term: 'x',
            id: 'y',
          },
          openedAt: '2026-10-05T14:02:11.000Z',
          extra: 'ignorado',
        },
        NOW,
      ),
    ).toEqual({
      ok: true,
      value: {
        code: 'K7P3M9QX',
        via: 'link',
        link: { kind: 'post', targetId: 'p-clipe' },
        utm: { source: 'instagram', medium: 'story', campaign: 'sao-joao' },
        openedAt: Date.parse('2026-10-05T14:02:11.000Z'),
      },
    });
  });

  it('código digitado: sem link, sem utm e openedAt null', () => {
    expect(
      parseClaimBody(
        {
          code: 'CAMILA12',
          via: 'code',
          link: null,
          utm: { source: 'x' },
          openedAt: '2026-10-05T14:00:00Z',
        },
        NOW,
      ),
    ).toEqual({
      ok: true,
      value: {
        code: 'CAMILA12',
        via: 'code',
        link: null,
        utm: { source: null, medium: null, campaign: null },
        openedAt: null,
      },
    });
  });

  it.each([
    [null, 'body'],
    [[], 'body'],
    [{ via: 'link', link }, 'code'],
    [{ code: 'ab', via: 'link', link }, 'code'],
    [{ code: 'a-b-', via: 'link', link }, 'code'],
    [{ code: 'K7P3M9Q!', via: 'link', link }, 'code'],
    [{ code: 'K7P3M9QX', via: 'install', link }, 'via'],
    [{ code: 'K7P3M9QX', link }, 'via'],
    [{ code: 'K7P3M9QX', via: 'code', link }, 'link'],
    [{ code: 'K7P3M9QX', via: 'link', link: null }, 'link'],
    [{ code: 'K7P3M9QX', via: 'link', link: { path: 'post/x' } }, 'link'],
    [{ code: 'K7P3M9QX', via: 'link', link: { path: '//site.com' } }, 'link'],
    [{ code: 'K7P3M9QX', via: 'link', link: { path: `/${'x'.repeat(200)}` } }, 'link'],
    [{ code: 'K7P3M9QX', via: 'link', link, utm: 'instagram' }, 'utm'],
    [{ code: 'K7P3M9QX', via: 'link', link, utm: { source: 'x'.repeat(201) } }, 'utm.source'],
    [{ code: 'K7P3M9QX', via: 'link', link, utm: { campaign: 12 } }, 'utm.campaign'],
    [{ code: 'K7P3M9QX', via: 'link', link, openedAt: 'ontem' }, 'openedAt'],
    [{ code: 'K7P3M9QX', via: 'link', link, openedAt: 123 }, 'openedAt'],
  ])('%j recusa no campo %s', (body, field) => {
    expect(parseClaimBody(body, NOW)).toEqual({ ok: false, field });
  });

  it('openedAt fora da faixa (mais de 30 dias antes, mais de 5 min depois) vira null', () => {
    const at = (ms: number) =>
      parseClaimBody(
        { code: 'K7P3M9QX', via: 'link', link, openedAt: new Date(ms).toISOString() },
        NOW,
      );
    expect(at(NOW - 30 * DAY_MS)).toMatchObject({ value: { openedAt: NOW - 30 * DAY_MS } });
    expect(at(NOW - 30 * DAY_MS - 1)).toMatchObject({ value: { openedAt: null } });
    expect(at(NOW + 5 * 60 * 1000)).toMatchObject({ value: { openedAt: NOW + 5 * 60 * 1000 } });
    expect(at(NOW + 5 * 60 * 1000 + 1)).toMatchObject({ value: { openedAt: null } });
  });

  it('o tipo nos shards: o do link, ou code para o código digitado', () => {
    expect(originKind({ via: 'code', link: null })).toBe('code');
    expect(originKind({ via: 'link', link: { kind: 'artist', targetId: 'nenho' } })).toBe('artist');
  });
});

describe('corpo da visita (parseVisitBody)', () => {
  it('como o do claim, sem via e com link obrigatório', () => {
    expect(
      parseVisitBody({ code: 'k7p3m9qx', link: { path: '/artista/nettobrito' }, utm: {} }, NOW),
    ).toEqual({
      ok: true,
      value: {
        code: 'K7P3M9QX',
        link: { kind: 'artist', targetId: 'nettobrito' },
        utm: { source: null, medium: null, campaign: null },
        openedAt: null,
      },
    });
    expect(parseVisitBody({ code: 'K7P3M9QX' }, NOW)).toEqual({ ok: false, field: 'link' });
    expect(parseVisitBody({ link: { path: '/' } }, NOW)).toEqual({ ok: false, field: 'code' });
  });
});

describe('link compartilhado (parseLinkId)', () => {
  it.each([
    ['invite', { linkId: 'invite', kind: 'invite', targetId: null }],
    ['agenda', { linkId: 'agenda', kind: 'agenda', targetId: null }],
    ['post:p-clipe', { linkId: 'post:p-clipe', kind: 'post', targetId: 'p-clipe' }],
    ['artist:nettobrito', { linkId: 'artist:nettobrito', kind: 'artist', targetId: 'nettobrito' }],
  ])('%s', (raw, link) => {
    expect(parseLinkId(raw)).toEqual(link);
  });

  it.each([
    ['artist:__trio__'],
    ['artist:Netto'],
    ['artist:ab'],
    ['post:'],
    [`post:${'x'.repeat(129)}`],
    ['post:a/b'],
    ['convite'],
    ['invite:x'],
    [''],
    [undefined],
  ])('%j é inválido', (raw) => {
    expect(parseLinkId(raw)).toBeNull();
  });
});
