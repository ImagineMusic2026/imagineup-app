import { inviteCodeFromPath, inviteRoute, parseInviteLink, safeDestination } from '../deep-link';

describe('link de convite', () => {
  it.each([
    ['/c/NETTO123', 'NETTO123'],
    ['c/NETTO123', 'NETTO123'],
    ['/c/NETTO123/?utm_source=whatsapp', 'NETTO123'],
    ['imagineup://c/abc_12-x', 'abc_12-x'],
    ['https://imaginegroup.com.br/c/ABC123', 'ABC123'],
    ['/convite/ABC123', 'ABC123'],
  ])('%s leva ao código %s', (path, code) => {
    expect(inviteCodeFromPath(path)).toBe(code);
  });

  it.each(['/', '/artista/netto', '/c/', '/c/ab', '/c/a/b', '/artista/netto?ref=a'])(
    '%s não é convite',
    (path) => {
      expect(inviteCodeFromPath(path)).toBeNull();
    },
  );

  it('link compartilhado com ?ref= guarda o código e a página de destino', () => {
    expect(
      parseInviteLink('https://imaginegroup.com.br/artista/netto?ref=ABC123&aba=agenda'),
    ).toEqual({ code: 'ABC123', destination: '/artista/netto?aba=agenda' });
    expect(parseInviteLink('imagineup://post/99?ref=ABC123')).toEqual({
      code: 'ABC123',
      destination: '/post/99',
    });
  });

  it('monta a rota interna', () => {
    expect(inviteRoute({ code: 'ABC123', destination: null })).toBe('/convite/ABC123');
    expect(inviteRoute({ code: 'ABC123', destination: '/artista/netto' })).toBe(
      '/convite/ABC123?destino=%2Fartista%2Fnetto',
    );
  });

  it.each([
    ['/artista/netto', '/artista/netto'],
    ['https://site-estranho.com', '/'],
    ['//site-estranho.com', '/'],
    [undefined, '/'],
  ])('destino %s vira %s', (value, expected) => {
    expect(safeDestination(value)).toBe(expected);
  });
});
