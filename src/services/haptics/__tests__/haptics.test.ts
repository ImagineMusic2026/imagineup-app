import * as Haptics from 'expo-haptics';

import { haptics } from '..';
import { hapticPatterns } from '../patterns';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: {
    Light: 'light',
    Medium: 'medium',
    Heavy: 'heavy',
    Soft: 'soft',
    Rigid: 'rigid',
  },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('haptics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    haptics.setEnabled(true);
  });

  it('todo evento tem um padrão de toque', () => {
    for (const steps of Object.values(hapticPatterns)) {
      expect(steps.length).toBeGreaterThan(0);
    }
  });

  it('curtir dá um toque leve', async () => {
    haptics.trigger('like');
    await flush();
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
  });

  it('missão concluída dá o toque de sucesso', async () => {
    haptics.trigger('missionComplete');
    await flush();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
  });

  it('desligado nas preferências, não toca nada', async () => {
    haptics.setEnabled(false);
    haptics.trigger('error');
    await flush();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('o mesmo evento em rajada vira um toque só', async () => {
    haptics.trigger('selection');
    haptics.trigger('selection');
    haptics.trigger('selection');
    await flush();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });
});
