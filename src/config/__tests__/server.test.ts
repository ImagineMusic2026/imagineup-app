import { resolveMediaUrl } from '../server';

/**
 * A URL das imagens do Storage com os emuladores (docs/arquitetura-api.md,
 * 24.1, decisão 14): as funções montam a URL de download com o host do
 * computador visto dele mesmo, que o emulador Android não alcança.
 */

const EMULATOR_URL =
  'http://127.0.0.1:9199/v0/b/demo-imagine-up-app.appspot.com/o/fans%2Fuid%2Fphoto-a.jpg?alt=media&token=t';

describe('resolveMediaUrl', () => {
  it('com o emulador, troca 127.0.0.1 e localhost da porta do Storage pelo host do app', () => {
    expect(resolveMediaUrl(EMULATOR_URL, '10.0.2.2')).toBe(
      'http://10.0.2.2:9199/v0/b/demo-imagine-up-app.appspot.com/o/fans%2Fuid%2Fphoto-a.jpg?alt=media&token=t',
    );
    expect(resolveMediaUrl(EMULATOR_URL.replace('127.0.0.1', 'localhost'), '192.168.0.10')).toBe(
      EMULATOR_URL.replace('127.0.0.1', '192.168.0.10'),
    );
  });

  it('sem emulador, a URL passa como veio', () => {
    expect(resolveMediaUrl(EMULATOR_URL, undefined)).toBe(EMULATOR_URL);
  });

  it('outra porta, outro host e a URL de produção passam iguais', () => {
    for (const url of [
      'http://127.0.0.1:8080/v0/b/x/o/a.jpg',
      'http://example.test:9199/v0/b/x/o/a.jpg',
      'https://firebasestorage.googleapis.com/v0/b/imagine-up-app.firebasestorage.app/o/fans%2Fu%2Fphoto-a.jpg?alt=media&token=t',
      'https://images.example/127.0.0.1:9199/a.jpg',
    ]) {
      expect(resolveMediaUrl(url, '10.0.2.2')).toBe(url);
    }
  });
});
