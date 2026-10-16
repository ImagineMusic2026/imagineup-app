import { isRunningInExpoGo } from 'expo';

import { isExpoGo as setupIsExpoGo } from '@/config/runtime';

/**
 * O `isExpoGo` de verdade só repete o `expo`. No Jest, o jest-expo traz o
 * módulo nativo `ExpoGo` falso, e o `isRunningInExpoGo()` daria verdadeiro em
 * toda suíte: o `jest.setup.js` troca o `@/config/runtime`, e este arquivo
 * lê o de verdade pelo `jest.requireActual`.
 */

jest.mock('expo', () => ({ isRunningInExpoGo: jest.fn() }));

const { isExpoGo } = jest.requireActual<typeof import('../runtime')>('../runtime');
const runningInExpoGo = jest.mocked(isRunningInExpoGo);

describe('isExpoGo', () => {
  it('diz o que o expo diz, dentro e fora do Expo Go', () => {
    runningInExpoGo.mockReturnValueOnce(true);
    expect(isExpoGo()).toBe(true);
    runningInExpoGo.mockReturnValueOnce(false);
    expect(isExpoGo()).toBe(false);
  });

  it('nas suítes, o jest.setup.js deixa o app fora do Expo Go', () => {
    expect(setupIsExpoGo()).toBe(false);
  });
});
