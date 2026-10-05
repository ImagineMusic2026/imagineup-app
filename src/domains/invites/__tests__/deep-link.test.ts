import {
  inviteCodeFromPath,
  inviteRoute,
  parseInviteLink,
  safeDestination,
  utmFromParams,
} from '../deep-link';

describe('link de convite', () => {
  it.each([
    ['/c/NETTO123', 'NETTO123'],
    ['c/NETTO123', 'NETTO123'],
    ['/c/NETTO123/?utm_source=whatsapp', 'NETTO123'],
    ['imagineup://c/abc_12-x', 'abc_12-x'],
    ['https://imaginegroup.com.br/c/ABC123', 'ABC123'],
    ['/convite/ABC123', 'ABC123'],
    ['exp://192.168.0.10:8081/--/c/ABC123', 'ABC123'],
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
    ).toEqual({ code: 'ABC123', destination: '/artista/netto?aba=agenda', utm: {} });
    expect(parseInviteLink('exp://192.168.0.10:8081/--/artista/netto?ref=ABC123')).toEqual({
      code: 'ABC123',
      destination: '/artista/netto',
      utm: {},
    });
    expect(parseInviteLink('imagineup://post/99?ref=ABC123')).toEqual({
      code: 'ABC123',
      destination: '/post/99',
      utm: {},
    });
  });

  it('os utm_* saem do destino; só source, medium e campaign ficam, também no link curto', () => {
    expect(
      parseInviteLink(
        'https://imagineup-painel.vercel.app/post/p-clipe?ref=K7P3M9QX&utm_source=instagram&utm_medium=story&utm_campaign=sao-joao&utm_content=ana%40x.com&utm_term=x&utm_id=9&aba=comentarios',
      ),
    ).toEqual({
      code: 'K7P3M9QX',
      destination: '/post/p-clipe?aba=comentarios',
      utm: { source: 'instagram', medium: 'story', campaign: 'sao-joao' },
    });
    expect(parseInviteLink('/c/K7P3M9QX?utm_source=whatsapp&utm_content=joao')).toEqual({
      code: 'K7P3M9QX',
      destination: null,
      utm: { source: 'whatsapp' },
    });
    expect(parseInviteLink('/?ref=K7P3M9QX&utm_campaign=sao-joao')).toEqual({
      code: 'K7P3M9QX',
      destination: '/',
      utm: { campaign: 'sao-joao' },
    });
  });

  it('cada utm_* com até 200 caracteres (o servidor recusa acima disso)', () => {
    const long = 'x'.repeat(250);
    expect(parseInviteLink(`/?ref=K7P3M9QX&utm_source=${long}`)?.utm.source).toHaveLength(200);
  });

  it('monta a rota interna, com os três utm_*', () => {
    expect(inviteRoute({ code: 'ABC123', destination: null, utm: {} })).toBe('/convite/ABC123');
    expect(inviteRoute({ code: 'ABC123', destination: '/artista/netto', utm: {} })).toBe(
      '/convite/ABC123?destino=%2Fartista%2Fnetto',
    );
    expect(
      inviteRoute({
        code: 'ABC123',
        destination: '/post/p-clipe',
        utm: { source: 'instagram', campaign: 'são joão' },
      }),
    ).toBe(
      '/convite/ABC123?destino=%2Fpost%2Fp-clipe&utm_source=instagram&utm_campaign=s%C3%A3o+jo%C3%A3o',
    );
  });

  it('a rota interna devolve os utm_* que levou', () => {
    expect(
      utmFromParams({ utm_source: 'instagram', utm_medium: '', utm_campaign: ['x'], destino: '/' }),
    ).toEqual({ source: 'instagram' });
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
