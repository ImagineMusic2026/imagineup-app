/**
 * O Google no iOS a partir do ID do cliente da constante do app.config.ts
 * (seção 33 de docs/arquitetura-api.md, 33.9). O ID fora do formato para o
 * `expo config` e o `eas build`, em vez de chegar calado ao TestFlight. Os IDs
 * daqui são inventados.
 */

type AppConfigModule = {
  default: (context: { config: object }) => {
    plugins?: unknown[];
    extra?: Record<string, unknown>;
  };
  googleIosSignIn: (clientId: string) => { clientId: string; urlScheme: string } | null;
};

// A configuração do Expo, na raiz do projeto.
const { default: appConfig, googleIosSignIn } =
  jest.requireActual<AppConfigModule>('../../../app.config');

const IOS_CLIENT_ID = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';

describe('googleIosSignIn', () => {
  it('vazio, o iOS fica sem o Google', () => {
    expect(googleIosSignIn('')).toBeNull();
  });

  it('com o CLIENT_ID, o esquema de volta é o ID ao contrário', () => {
    expect(googleIosSignIn(IOS_CLIENT_ID)).toEqual({
      clientId: IOS_CLIENT_ID,
      urlScheme: 'com.googleusercontent.apps.123456789012-abcdefghijklmnopqrstuvwxyz012345',
    });
  });

  it.each([
    [
      'o REVERSED_CLIENT_ID no lugar do CLIENT_ID',
      'com.googleusercontent.apps.123456789012-abcdefghijklmnopqrstuvwxyz012345',
    ],
    ['com espaço nas pontas', ` ${IOS_CLIENT_ID}`],
    ['sem o sufixo do Google', '123456789012-abc'],
    ['só o sufixo', '.apps.googleusercontent.com'],
  ])('%s para a configuração com o motivo', (_case, value) => {
    expect(() => googleIosSignIn(value)).toThrow(/REVERSED_CLIENT_ID/);
  });

  it('com a constante vazia de hoje, nem o plugin do Google nem o extra', () => {
    const config = appConfig({ config: {} });
    const plugins = (config.plugins ?? []).map((plugin) =>
      Array.isArray(plugin) ? plugin[0] : plugin,
    );
    expect(plugins).not.toContain('@react-native-google-signin/google-signin');
    expect(config.extra).not.toHaveProperty('googleIosClientId');
  });
});
