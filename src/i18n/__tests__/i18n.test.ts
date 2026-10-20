import { SUPPORT_EMAIL } from '@/config/links';

import { t, type TranslationKey } from '..';
import translations from '../translations.json';

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

/** Todos os textos do arquivo, de todos os níveis. */
function allTexts(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (typeof node !== 'object' || node === null) return [];
  return Object.values(node).flatMap(allTexts);
}

describe('translations.json', () => {
  it('nenhum texto escreve um endereço de e-mail: as frases usam {{email}} (seção 29)', () => {
    const emails = allTexts(translations).filter((text) =>
      /[^\s@{}]+@[^\s@{}]+\.[^\s@{}]+/.test(text),
    );
    expect(emails).toEqual([]);
    expect(JSON.stringify(translations)).not.toContain(SUPPORT_EMAIL);
    // As frases que mostram o contato recebem o endereço do `SUPPORT_EMAIL`.
    expect(t('suspension.alertMessage', { email: SUPPORT_EMAIL })).toContain(SUPPORT_EMAIL);
    expect(t('settings.contactError', { email: SUPPORT_EMAIL })).toContain(SUPPORT_EMAIL);
  });

  it('nenhum texto tem travessão nem meia-risca (seção 34, 34.13)', () => {
    const dashes = allTexts(translations).filter((text) => /[\u2013\u2014]/.test(text));
    expect(dashes).toEqual([]);
  });
});
