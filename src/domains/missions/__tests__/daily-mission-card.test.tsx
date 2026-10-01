import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import { t } from '@/i18n';
import { api } from '@/services/api';
import { setFixtureNow } from '@/services/fixtures';
import { haptics } from '@/services/haptics';

import { fetchDailyMission } from '../api';
import { DailyMissionCard, DailyMissionSection } from '../components/daily-mission-card';
import { buildDailyMissionFixture } from '../fixtures';
import type { DailyMission } from '../types';

// Só a navegação imperativa sai do ar; o resto (tema de navegação) é o de verdade.
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), navigate: jest.fn() },
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn() } }));

// Lido na hora da chamada: cada teste escolhe a fonte.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/env', () => ({
  get dataSource() {
    return mockDataSource;
  },
}));

const get = jest.mocked(api.get);
const push = jest.mocked(router.push);
const navigate = jest.mocked(router.navigate);

const NOW = new Date(2026, 8, 29, 20, 0);
const MISSION = buildDailyMissionFixture(NOW);
const SUMMARY = 'Missão de hoje, termina em 4 horas, vale 20 pontos';
const hidden = { includeHiddenElements: true } as const;

function completed(mission: DailyMission): DailyMission {
  return { ...mission, status: 'completed', progress: { ...mission.progress, current: 5 } };
}

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  setFixtureNow(null);
  client.clear();
  jest.restoreAllMocks();
});

describe('missão do dia de exemplo', () => {
  it('é a da home do protótipo: 3 de 5, vale 20 e termina em 4 h', async () => {
    setFixtureNow(NOW);
    await expect(fetchDailyMission()).resolves.toMatchObject({
      title: 'Leve 5 pessoas para o clipe novo do Netto',
      rewardPoints: 20,
      progress: { current: 3, target: 5 },
      status: 'active',
      action: 'share',
      target: { postId: 'p-clipe' },
    });
    render(<DailyMissionCard mission={MISSION} now={NOW} />);
    expect(screen.getByText(t('missions.daily.badge', { time: '4 h' }))).toBeTruthy();
  });

  it('com a API, pede /missions/daily, e sem missão hoje vem null', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { mission: null } });
    await expect(fetchDailyMission()).resolves.toBeNull();
    expect(get).toHaveBeenCalledWith('/missions/daily');
  });
});

describe('card da missão do dia', () => {
  it('selo e recompensa, lidos juntos e com as horas por extenso, abrem a seção como cabeçalho', () => {
    render(<DailyMissionCard mission={MISSION} now={NOW} />);
    expect(screen.getByRole('header', { name: SUMMARY })).toBeTruthy();
    // O título vem logo depois, como texto: um cabeçalho só por seção.
    expect(screen.getByText(MISSION.title)).toBeTruthy();
    expect(screen.queryByRole('header', { name: MISSION.title })).toBeNull();
  });

  it('a barra é um progressbar "3 de 5", e o "3/5" visível fica fora do leitor', () => {
    render(<DailyMissionCard mission={MISSION} now={NOW} />);
    const bar = screen.getByRole('progressbar', { name: '3 de 5' });
    expect(bar).toHaveProp('accessibilityValue', { min: 0, max: 5, now: 3 });
    expect(screen.queryByText('3/5')).toBeNull();
    expect(screen.getByText('3/5', hidden)).toBeTruthy();
  });

  it('"Gerar meu link" abre o convite com a missão e o post, e "Ver missões" abre a 1g', () => {
    render(<DailyMissionCard mission={MISSION} now={NOW} />);

    const link = screen.getByRole('button', { name: 'Gerar meu link' });
    const missions = screen.getByRole('button', { name: 'Ver missões' });
    expect(link).toHaveStyle({ minHeight: 44 });
    expect(missions).toHaveStyle({ minHeight: 44 });

    fireEvent.press(link);
    fireEvent.press(missions);
    expect(push).toHaveBeenCalledWith({
      pathname: '/convidar',
      params: { missionId: MISSION.id, postId: 'p-clipe' },
    });
    // Na pilha da Ranking com a 1f embaixo, sem empilhar a 1g de novo.
    expect(navigate).toHaveBeenCalledWith('/missoes', { withAnchor: true });
  });

  it('concluída: barra cheia, selo de concluída e "Ver missões" como botão principal', () => {
    render(<DailyMissionCard mission={completed(MISSION)} now={NOW} />);

    expect(screen.getByLabelText('Missão de hoje concluída, valeu 20 pontos')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: '5 de 5' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Gerar meu link' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ver missões' })).toHaveStyle({ flex: 1 });
  });

  it('concluir com a tela aberta vibra e anuncia uma vez; abrir já concluída, não', () => {
    const announce = jest.mocked(AccessibilityInfo.announceForAccessibilityWithOptions);
    const { rerender } = render(<DailyMissionCard mission={MISSION} now={NOW} />);
    rerender(<DailyMissionCard mission={completed(MISSION)} now={NOW} />);
    rerender(<DailyMissionCard mission={completed(MISSION)} now={NOW} />);
    expect(haptics.trigger).toHaveBeenCalledTimes(1);
    expect(haptics.trigger).toHaveBeenCalledWith('missionComplete');
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Missão de hoje concluída. Mais 20 pontos', {
      queue: true,
    });

    jest.mocked(haptics.trigger).mockClear();
    announce.mockClear();
    render(<DailyMissionCard mission={completed(MISSION)} now={NOW} />);
    expect(haptics.trigger).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it('concluir com a home fora de foco não vibra nem anuncia, nem quando ela volta', () => {
    // O fã está na 1g, que festeja a mesma missão: só a tela que ele vê fala.
    const announce = jest.mocked(AccessibilityInfo.announceForAccessibilityWithOptions);
    const { rerender } = render(<DailyMissionCard mission={MISSION} now={NOW} celebrate={false} />);
    rerender(<DailyMissionCard mission={completed(MISSION)} now={NOW} celebrate={false} />);
    rerender(<DailyMissionCard mission={completed(MISSION)} now={NOW} celebrate />);

    expect(haptics.trigger).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Missão de hoje concluída, valeu 20 pontos')).toBeTruthy();
  });

  it('a conclusão que só aparece junto com a volta do foco também não festeja', () => {
    // A aba escondida pode só ver o dado novo quando o fã volta a ela.
    const announce = jest.mocked(AccessibilityInfo.announceForAccessibilityWithOptions);
    const { rerender } = render(<DailyMissionCard mission={MISSION} now={NOW} celebrate={false} />);
    rerender(<DailyMissionCard mission={completed(MISSION)} now={NOW} celebrate />);

    expect(haptics.trigger).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });
});

describe('missão do dia na home', () => {
  it('carregando, mostra o esqueleto do card; depois, a missão', async () => {
    render(<DailyMissionSection />, { wrapper });
    expect(screen.getByLabelText(t('missions.daily.loading'))).toBeTruthy();
    expect(await screen.findByText(MISSION.title)).toBeTruthy();
  });

  it('sem missão hoje, não mostra nada (a tela sobe)', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { mission: null } });
    render(<DailyMissionSection />, { wrapper });
    await waitFor(() => expect(screen.queryByLabelText(t('missions.daily.loading'))).toBeNull());
    expect(screen.toJSON()).toBeNull();
  });

  it('com o prazo vencido, some na hora e busca a próxima', async () => {
    // A missão das fixtures termina 4 h e meia depois deste relógio: já passou.
    setFixtureNow(new Date(Date.now() - 5 * 60 * 60 * 1000));
    render(<DailyMissionSection />, { wrapper });

    await waitFor(() => expect(screen.queryByLabelText(t('missions.daily.loading'))).toBeNull());
    expect(screen.queryByText(MISSION.title)).toBeNull();
    await waitFor(() =>
      expect(client.getQueryState(['missions', 'daily'])?.dataUpdateCount).toBe(2),
    );
  });

  it('expirada pelo servidor, também some e busca a próxima', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { mission: { ...MISSION, status: 'expired' } } });
    render(<DailyMissionSection />, { wrapper });

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(MISSION.title)).toBeNull();
  });

  it('a contagem anda sozinha com a tela aberta', async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    render(<DailyMissionSection />, { wrapper });
    expect(await screen.findByText(t('missions.daily.badge', { time: '4 h' }))).toBeTruthy();

    // Uma hora depois, faltam 3 h e meia.
    act(() => jest.advanceTimersByTime(60 * 60 * 1000));
    expect(screen.getByText(t('missions.daily.badge', { time: '3 h' }))).toBeTruthy();
  });

  it('se não carregou, mostra o erro com "Tentar de novo", que busca de novo', async () => {
    // Relógio fixo: com o relógio real, a missão de exemplo expira às 0h30 de 30/09 e some.
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    mockDataSource = 'api';
    get.mockRejectedValueOnce(new Error('rede')).mockResolvedValue({ data: { mission: MISSION } });
    render(<DailyMissionSection />, { wrapper });

    expect(await screen.findByLabelText(t('missions.daily.loadError'))).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(MISSION.title)).toBeTruthy();
  });
});
