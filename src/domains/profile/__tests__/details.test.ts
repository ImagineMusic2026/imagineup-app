import {
  BIO_MAX,
  BIO_MAX_LINES,
  genderOf,
  GENDERS,
  isSocialHandle,
  normalizeSocialHandle,
  SOCIAL_INPUT_MAX,
  SOCIAL_NETWORKS,
  socialsOf,
  socialUrl,
} from '../details';
import type { SocialNetwork } from '../types';

// Os campos novos do perfil (seção 28 de docs/arquitetura-api.md): a mesma
// tabela das redes de functions/src/fan-profile/details.test.ts (mudou uma,
// mude a outra), o link montado com o domínio fixo e a leitura do perfil
// guardado.

describe('constantes', () => {
  it('os limites, os gêneros e as redes na ordem da tela, iguais aos do servidor', () => {
    expect(BIO_MAX).toBe(200);
    expect(BIO_MAX_LINES).toBe(6);
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

describe('socialUrl', () => {
  it.each([
    ['instagram', 'camila.teste.up', 'https://www.instagram.com/camila.teste.up/'],
    ['tiktok', 'camila.teste.up', 'https://www.tiktok.com/@camila.teste.up'],
    ['linkedin', 'thalita-teste-imagineup', 'https://www.linkedin.com/in/thalita-teste-imagineup/'],
    ['x', 'thalitatesteup', 'https://x.com/thalitatesteup'],
  ] as const)('%s: o link com o domínio fixo', (network, handle, url) => {
    expect(socialUrl(network, handle)).toBe(url);
  });

  it('o LinkedIn com acento vai codificado', () => {
    expect(socialUrl('linkedin', 'joão-teste')).toBe(
      'https://www.linkedin.com/in/jo%C3%A3o-teste/',
    );
  });

  it.each([
    ['instagram', 'https://golpe.example/camila'],
    ['instagram', 'Camila.Teste'],
    ['tiktok', '@camila.teste.up'],
    ['linkedin', 'thalitaㅤteste'],
    ['x', 'a'.repeat(16)],
    ['x', ''],
    // Uma página da rede guardada por seed ou carga abriria a timeline de quem toca.
    ['x', 'home'],
    ['instagram', 'explore'],
  ] as const)('%s: o usuário fora do padrão (%j) não vira link', (network, handle) => {
    expect(socialUrl(network, handle)).toBeNull();
  });

  it('sem usuário, sem link', () => {
    expect(socialUrl('instagram', null)).toBeNull();
    expect(socialUrl('x', undefined)).toBeNull();
  });
});

describe('leitura do perfil guardado', () => {
  it('o gênero só dos quatro valores', () => {
    expect(genderOf('woman')).toBe('woman');
    expect(genderOf('undisclosed')).toBe('undisclosed');
    for (const value of [null, undefined, 'other', 'Woman', 1, {}]) {
      expect(genderOf(value)).toBeNull();
    }
  });

  it('as redes pela lista fixa: a torta vira null, a chave estranha sai e sem nenhuma é null', () => {
    expect(
      socialsOf({
        instagram: 'camila.teste.up',
        tiktok: 'https://www.tiktok.com/@golpe',
        x: 42,
        facebook: 'camila',
      }),
    ).toEqual({ instagram: 'camila.teste.up', tiktok: null, linkedin: null, x: null });
    expect(socialsOf({ instagram: null, tiktok: null, linkedin: null, x: null })).toBeNull();
    expect(socialsOf({ instagram: 'Camila' })).toBeNull();
    for (const value of [null, undefined, 'camila', ['camila']]) {
      expect(socialsOf(value)).toBeNull();
    }
  });

  it('o __proto__ do mapa guardado não vira rede', () => {
    expect(socialsOf(JSON.parse('{"__proto__": {"instagram": "camila"}}'))).toBeNull();
  });
});
