import {
  AUTOMATIC_USERNAME,
  isAutomaticUsername,
  isUsernameFormat,
  normalizeUsername,
  USERNAME_PATTERN,
} from '../username';

// Espelho de functions/src/fan-profile/model.ts (a mesma tabela de lá): mudou
// um, mude o outro (docs/arquitetura-api.md, 24.12).

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

describe('formato e automático', () => {
  it.each(['camilaribeiro', 'abc', 'a'.repeat(20), 'fabio', 'mc2', 'fa123456'])(
    '%s está no formato',
    (username) => {
      expect(isUsernameFormat(username)).toBe(true);
    },
  );

  it.each([
    'ab',
    'a'.repeat(21),
    'camila_rib',
    'camila.rib',
    'camilaribeirõ',
    '@camila',
    'Camila',
    '',
  ])('%j está fora do formato', (username) => {
    expect(isUsernameFormat(username)).toBe(false);
  });

  it('o automático é fa com dígitos; fabio e fa sozinho não', () => {
    for (const username of ['fa123456', 'fa12', 'fa1'])
      expect(isAutomaticUsername(username)).toBe(true);
    for (const username of ['fabio', 'fa', 'fa12a', null, undefined]) {
      expect(isAutomaticUsername(username)).toBe(false);
    }
  });

  it('os padrões são os do servidor', () => {
    expect(USERNAME_PATTERN.source).toBe('^[a-z0-9]{3,20}$');
    expect(AUTOMATIC_USERNAME.source).toBe('^fa[0-9]+$');
  });
});
