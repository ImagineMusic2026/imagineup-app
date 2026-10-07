import type { DataDomain } from '../data-source';

/**
 * O seletor por domínio (docs/arquitetura-api.md, seção 13): sem API tudo nas
 * fixtures (as builds de hoje); com a API (o emulador em desenvolvimento, ou o
 * EXPO_PUBLIC_API_URL depois do deploy), só os domínios com rota no servidor.
 */

const DOMAINS: DataDomain[] = [
  'wallet',
  'achievements',
  'invite',
  'artists',
  'posts',
  'agenda',
  'missions',
  'ranking',
  'profile',
  'rewards',
];

/** O data-source com o env dado, carregado de novo. */
function load(env: { apiUrl?: string }): typeof import('../data-source') {
  let loaded: typeof import('../data-source') | undefined;
  jest.isolateModules(() => {
    jest.doMock('../server', () => ({ apiUrl: env.apiUrl }));
    loaded = jest.requireActual('../data-source');
  });
  return loaded!;
}

/** O endereço do servidor como o app monta (sem a configuração do Firebase). */
const realServer = (): typeof import('../server') => jest.requireActual('../server');

describe('fonte de cada domínio', () => {
  it('sem API (builds de hoje), tudo nas fixtures', () => {
    const { sourceOf, usesFixtures } = load({ apiUrl: undefined });
    for (const domain of DOMAINS) expect(sourceOf(domain)).toBe('fixtures');
    expect(usesFixtures()).toBe(true);
  });

  it('com a API, a carteira (bloco 1), as centrais (bloco 4), o convite (bloco 5), o mural e a agenda (bloco 6), as missões e conquistas (bloco 7), o ranking (bloco 8) e o @ e a foto (bloco 9) vão para o servidor; o resto segue nas fixtures', () => {
    const { sourceOf, usesFixtures, SERVER_DOMAINS } = load({
      apiUrl: 'https://southamerica-east1-imagine-up-app.cloudfunctions.net/api',
    });
    expect([...SERVER_DOMAINS]).toEqual([
      'wallet',
      'artists',
      'invite',
      'posts',
      'agenda',
      'missions',
      'achievements',
      'ranking',
      'profile',
    ]);
    expect(DOMAINS.filter((domain) => sourceOf(domain) === 'api')).toEqual([
      'wallet',
      'achievements',
      'invite',
      'artists',
      'posts',
      'agenda',
      'missions',
      'ranking',
      'profile',
    ]);
    expect(usesFixtures()).toBe(true);
  });

  it('com o emulador, as centrais, o convite, o mural, a agenda, as missões, as conquistas, o ranking e o perfil vêm da api dele; a loja não', () => {
    const emulatorApi = realServer().resolveApiUrl('10.0.2.2', undefined);
    const { sourceOf } = load({ apiUrl: emulatorApi });
    expect(sourceOf('artists')).toBe('api');
    expect(sourceOf('invite')).toBe('api');
    expect(sourceOf('posts')).toBe('api');
    expect(sourceOf('agenda')).toBe('api');
    expect(sourceOf('missions')).toBe('api');
    expect(sourceOf('achievements')).toBe('api');
    expect(sourceOf('ranking')).toBe('api');
    expect(sourceOf('profile')).toBe('api');
    expect(sourceOf('rewards')).toBe('fixtures');
  });
});

describe('endereço da API', () => {
  it('com os emuladores, a api do emulador de Functions, montada do host, sem variável nova', () => {
    const { resolveApiUrl } = realServer();
    expect(resolveApiUrl('10.0.2.2', undefined)).toBe(
      'http://10.0.2.2:5001/demo-imagine-up-app/southamerica-east1/api',
    );
  });

  it('com os emuladores, o EXPO_PUBLIC_API_URL fica de fora (o token do emulador não vale lá)', () => {
    const { resolveApiUrl } = realServer();
    expect(resolveApiUrl('127.0.0.1', 'https://api.exemplo.dev')).toBe(
      'http://127.0.0.1:5001/demo-imagine-up-app/southamerica-east1/api',
    );
  });

  it('sem emulador, o EXPO_PUBLIC_API_URL como está; sem ele, nada', () => {
    const { resolveApiUrl } = realServer();
    expect(resolveApiUrl(undefined, 'https://api.exemplo.dev')).toBe('https://api.exemplo.dev');
    expect(resolveApiUrl(undefined, undefined)).toBeUndefined();
  });

  it('o projeto do emulador é o demo, o mesmo do Firebase do app', () => {
    expect(realServer().EMULATOR_PROJECT_ID).toBe('demo-imagine-up-app');
  });
});
