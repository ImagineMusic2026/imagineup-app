import { t, type TranslationKey } from '..';

describe('t()', () => {
  it('devolve o texto em pt-BR pela chave', () => {
    expect(t('tabs.home')).toBe('Início');
  });

  it('preenche os parâmetros', () => {
    expect(t('missions.progressLabel', { done: 12, total: 20 })).toBe('12 de 20 concluídas');
  });

  it('devolve a própria chave quando falta texto, sem quebrar a tela', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(t('nao.existe' as TranslationKey)).toBe('nao.existe');
    warn.mockRestore();
  });
});
