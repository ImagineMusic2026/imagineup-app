import { router } from 'expo-router';

import { backToWelcome, normalizedEmail } from '../entry-questions';

describe('voltar da primeira pergunta', () => {
  // O roteador é o de verdade (o tema e o convite, que chegam por aqui, usam
  // o pacote inteiro): o teste só vigia o que o voltar chama nele.
  beforeEach(() => {
    jest.spyOn(router, 'back').mockImplementation(() => undefined);
    jest.spyOn(router, 'replace').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('com tela embaixo (veio da abertura), volta para ela', () => {
    jest.spyOn(router, 'canGoBack').mockReturnValue(true);

    backToWelcome();

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('aberta a frio, sem para onde voltar, troca a tela pela abertura', () => {
    jest.spyOn(router, 'canGoBack').mockReturnValue(false);

    backToWelcome();

    expect(router.replace).toHaveBeenCalledTimes(1);
    // A abertura, e não o início (`/`), que o guard barra para quem está fora.
    expect(router.replace).toHaveBeenCalledWith('/entrar');
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('e-mail como ele vai para a conta', () => {
  it.each([
    ['camila@x.com', 'camila@x.com'],
    [' Camila@X.com ', 'camila@x.com'],
    ['CAMILA@X.COM\n', 'camila@x.com'],
  ])('"%s" sai sem os espaços das pontas e em minúsculas', (typed, expected) => {
    expect(normalizedEmail(typed)).toBe(expected);
  });

  it.each([
    ['', ''],
    ['   ', ''],
    [' Camila ', 'Camila'],
    [' Camila@ ', 'Camila@'],
  ])(
    'fora do formato, "%s" sai como foi digitado, só sem os espaços das pontas',
    (typed, expected) => {
      expect(normalizedEmail(typed)).toBe(expected);
    },
  );
});
