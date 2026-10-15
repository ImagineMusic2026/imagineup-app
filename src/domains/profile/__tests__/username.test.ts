import {
  AUTOMATIC_USERNAME,
  isAutomaticUsername,
  isUsernameFormat,
  lockReasonOf,
  normalizeUsername,
  USERNAME_PATTERN,
  usernameLock,
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

describe('o prazo do @ (seção 32)', () => {
  // Quarta, 7 de outubro de 2026, meio-dia em São Paulo.
  const NOW = new Date('2026-10-07T15:00:00.000Z');
  const FUTURE = '2026-11-06T15:00:00.000Z';

  it('quem pôs o prazo: só moderation; o ausente, null e o valor estranho valem null', () => {
    expect(lockReasonOf('moderation')).toBe('moderation');
    for (const value of [null, undefined, 'central', 'Moderation', 1, true, {}]) {
      expect(lockReasonOf(value)).toBeNull();
    }
  });

  it('sem prazo, nada trava, com ou sem o motivo', () => {
    expect(usernameLock(null, NOW)).toBeNull();
    expect(usernameLock(undefined, NOW)).toBeNull();
    expect(usernameLock({}, NOW)).toBeNull();
    expect(usernameLock({ usernameChangeableAt: null }, NOW)).toBeNull();
    // O motivo sozinho, sem o prazo, não trava.
    expect(
      usernameLock({ usernameChangeableAt: null, usernameLockReason: 'moderation' }, NOW),
    ).toBeNull();
  });

  it('o prazo que já passou (ou o instante de agora) não trava; a data torta também não', () => {
    expect(usernameLock({ usernameChangeableAt: '2026-10-07T14:59:00.000Z' }, NOW)).toBeNull();
    expect(usernameLock({ usernameChangeableAt: NOW.toISOString() }, NOW)).toBeNull();
    expect(
      usernameLock(
        { usernameChangeableAt: '2026-10-07T14:59:00.000Z', usernameLockReason: 'moderation' },
        NOW,
      ),
    ).toBeNull();
    expect(usernameLock({ usernameChangeableAt: 'não é data' }, NOW)).toBeNull();
  });

  it('o prazo do fã trava sem a equipe; o perfil de antes, sem o motivo, também', () => {
    expect(usernameLock({ usernameChangeableAt: FUTURE, usernameLockReason: null }, NOW)).toEqual({
      until: FUTURE,
      byTeam: false,
    });
    expect(usernameLock({ usernameChangeableAt: FUTURE }, NOW)).toEqual({
      until: FUTURE,
      byTeam: false,
    });
  });

  it('o prazo da equipe trava com a equipe', () => {
    expect(
      usernameLock({ usernameChangeableAt: FUTURE, usernameLockReason: 'moderation' }, NOW),
    ).toEqual({ until: FUTURE, byTeam: true });
  });
});
