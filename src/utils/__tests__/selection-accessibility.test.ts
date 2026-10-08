import { Platform } from 'react-native';

import { selectionAccessibility } from '../selection-accessibility';

// O papel de quem se escolhe tocando: no iOS sempre botão com "selecionado";
// no Android, aba, caixa de marcar ou rádio, conforme a lista.

afterEach(() => {
  jest.restoreAllMocks();
});

describe('selectionAccessibility', () => {
  it('no iOS é botão com selecionado, em qualquer modo', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    for (const mode of ['single', 'multiple', 'radio'] as const) {
      expect(selectionAccessibility(mode, true)).toEqual({
        role: 'button',
        state: { selected: true },
      });
    }
  });

  it('no Android: aba na fileira de abas, caixa de marcar na múltipla e rádio na lista de opções', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    expect(selectionAccessibility('single', true)).toEqual({
      role: 'tab',
      state: { selected: true },
    });
    expect(selectionAccessibility('multiple', false)).toEqual({
      role: 'checkbox',
      state: { checked: false },
    });
    expect(selectionAccessibility('radio', true)).toEqual({
      role: 'radio',
      state: { checked: true },
    });
  });
});
