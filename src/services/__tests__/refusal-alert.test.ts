import { Alert, Linking, type AlertButton } from 'react-native';

import {
  alertActionRefusal,
  REFUSAL_ALERT_LOCK_MS,
  resetRefusalAlerts,
  showRefusalAlert,
} from '../refusal-alert';

// Os `Alert` de recusa (seção 29 de docs/arquitetura-api.md, decisões 19 e
// 20): um helper só, com a trava de 30 s por tipo e ação e o relógio injetado.

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(() => Promise.resolve()) }));

let alert: jest.SpyInstance;

beforeEach(() => {
  resetRefusalAlerts();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

const lastAlert = () => {
  const [title, message, buttons] = alert.mock.calls.at(-1) as [string, string, AlertButton[]];
  return { title, message, buttons };
};

describe('showRefusalAlert', () => {
  it('duas curtidas no teto em 30 s: um Alert', () => {
    expect(showRefusalAlert('dailyLimit', 'like', 0)).toBe(true);
    expect(showRefusalAlert('dailyLimit', 'like', 10_000)).toBe(false);
    expect(showRefusalAlert('dailyLimit', 'like', REFUSAL_ALERT_LOCK_MS - 1)).toBe(false);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(lastAlert()).toEqual({
      title: 'Limite de hoje',
      message: 'Você chegou ao limite de curtidas de hoje. Tente amanhã.',
      buttons: [{ text: 'Entendi', style: 'cancel' }],
    });
  });

  it('passados 30 s, abre de novo', () => {
    showRefusalAlert('dailyLimit', 'like', 0);
    expect(showRefusalAlert('dailyLimit', 'like', REFUSAL_ALERT_LOCK_MS)).toBe(true);
    expect(alert).toHaveBeenCalledTimes(2);
  });

  it('curtida e "Eu vou" no teto: dois, cada um com a frase dele', () => {
    showRefusalAlert('dailyLimit', 'like', 0);
    showRefusalAlert('dailyLimit', 'rsvp', 1000);
    expect(alert).toHaveBeenCalledTimes(2);
    expect(lastAlert().message).toBe('Você chegou ao limite de presenças de hoje. Tente amanhã.');
  });

  it('a conta suspensa tem a trava dela, separada do teto', () => {
    showRefusalAlert('dailyLimit', 'join', 0);
    expect(showRefusalAlert('suspended', null, 1000)).toBe(true);
    expect(showRefusalAlert('suspended', null, 2000)).toBe(false);
    expect(alert).toHaveBeenCalledTimes(2);
  });

  it('"Conta suspensa": a mensagem com o e-mail e o "Escrever para a equipe"', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    showRefusalAlert('suspended', null, 0);
    const { title, message, buttons } = lastAlert();
    expect(title).toBe('Conta suspensa');
    expect(message).toBe(
      'A equipe do ImagineUP suspendeu sua conta. Você continua vendo o app, mas não pode curtir, comentar, confirmar presença, entrar em centrais, resgatar, denunciar nem mudar o perfil. Para entender ou pedir revisão, escreva para music@imaginegroup.com.br.',
    );
    expect(buttons.map((button) => button.text)).toEqual(['Escrever para a equipe', 'Entendi']);
    buttons[0]?.onPress?.();
    await Promise.resolve();
    expect(openURL).toHaveBeenCalledWith(
      'mailto:music@imaginegroup.com.br?subject=Conta%20suspensa%20no%20ImagineUP',
    );
  });

  it('o fim da sessão solta as travas', () => {
    showRefusalAlert('dailyLimit', 'like', 0);
    resetRefusalAlerts();
    expect(showRefusalAlert('dailyLimit', 'like', 1000)).toBe(true);
  });

  it('usa o relógio do aparelho sem o injetado', () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-13T15:00:00.000Z') });
    try {
      expect(showRefusalAlert('dailyLimit', 'comment')).toBe(true);
      jest.advanceTimersByTime(REFUSAL_ALERT_LOCK_MS - 1);
      expect(showRefusalAlert('dailyLimit', 'comment')).toBe(false);
      jest.advanceTimersByTime(1);
      expect(showRefusalAlert('dailyLimit', 'comment')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('alertActionRefusal', () => {
  it('o teto do dia: abre o "Limite de hoje" e diz que abriu; com a trava, diz que não', () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-13T15:00:00.000Z') });
    try {
      expect(alertActionRefusal('dailyLimit', 'rsvp')).toBe(true);
      expect(alertActionRefusal('dailyLimit', 'rsvp')).toBe(false);
      expect(alert).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a conta suspensa: o que o watcher fez com a última recusa, sem abrir outro', () => {
    expect(alertActionRefusal('suspended', 'like')).toBe(false);
    expect(showRefusalAlert('suspended', null, 0)).toBe(true);
    expect(alertActionRefusal('suspended', 'like')).toBe(true);
    expect(showRefusalAlert('suspended', null, 1000)).toBe(false);
    expect(alertActionRefusal('suspended', 'join')).toBe(false);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('o ritmo e o genérico nunca têm Alert', () => {
    expect(alertActionRefusal('rateLimited', 'like')).toBe(false);
    expect(alertActionRefusal(null, 'like')).toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });

  it('o fim da sessão esquece a última recusa', () => {
    showRefusalAlert('suspended', null, 0);
    resetRefusalAlerts();
    expect(alertActionRefusal('suspended', 'like')).toBe(false);
  });
});
