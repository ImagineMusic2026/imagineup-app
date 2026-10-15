/**
 * O ID do cliente Web do Google (seção 33 de docs/arquitetura-api.md): sem ele,
 * o Google fica desligado e o botão não aparece. O `jest.setup.js` deixa o
 * `googleWebClientId` vazio em toda suíte; este arquivo lê a conferência de
 * verdade pelo `jest.requireActual`.
 */

// O env.ts avisa no console ao carregar sem a configuração do Firebase (o Jest
// não lê o .env): o espião vem antes, e os testes contam só os avisos deles.
const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

const { parseGoogleWebClientId } = jest.requireActual<typeof import('../env')>('../env');
const setupEnv = jest.requireMock<typeof import('../env')>('@/config/env');

const WEB_CLIENT_ID = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';

describe('parseGoogleWebClientId', () => {
  beforeEach(() => {
    warn.mockClear();
  });

  afterAll(() => {
    warn.mockRestore();
  });

  it('aceita o ID do cliente Web, sem os espaços das pontas', () => {
    expect(parseGoogleWebClientId(WEB_CLIENT_ID)).toBe(WEB_CLIENT_ID);
    expect(parseGoogleWebClientId(`  ${WEB_CLIENT_ID}\n`)).toBe(WEB_CLIENT_ID);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['ausente', undefined],
    ['vazio', ''],
    ['só espaços', '   '],
  ])('%s desliga o Google sem avisar', (_case, value) => {
    expect(parseGoogleWebClientId(value)).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['sem o sufixo do Google', '123456789012-abc'],
    ['o esquema do iOS no lugar do ID', 'com.googleusercontent.apps.123456789012-abc'],
    ['com espaço no meio', '123456789012 abc.apps.googleusercontent.com'],
    ['só o sufixo', '.apps.googleusercontent.com'],
  ])('%s desliga o Google e avisa no console', (_case, value) => {
    expect(parseGoogleWebClientId(value)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('nas suítes, o jest.setup.js deixa o Google desligado', () => {
    expect(setupEnv.googleWebClientId).toBeUndefined();
  });
});
