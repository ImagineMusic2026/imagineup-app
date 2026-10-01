import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import type { ReactTestInstance } from 'react-test-renderer';

import { PressableScale } from '@/components/pressable-scale';
import { haptics } from '@/services/haptics';
import { motion } from '@/theme';

import { FeaturedRewardCard } from '../components/featured-reward-card';
import { RewardCard } from '../components/reward-card';
import { RewardSummary } from '../components/reward-summary';
import { buildRewardsFixture } from '../fixtures';
import type { Reward } from '../types';

const NOW = new Date(2026, 8, 29, 20, 0);
const { rewards } = buildRewardsFixture(NOW);
const hidden = { includeHiddenElements: true } as const;

function byId(id: string): Reward {
  const reward = rewards.find((item) => item.id === id);
  if (!reward) throw new Error(`recompensa ${id} não existe nas fixtures`);
  return reward;
}

const MEET = byId('meet-netto');
const TICKETS = byId('ingressos');
const VIDEO = byId('videochamada');
const SHIRT = byId('camisa');

/** Pressáveis dentro de outro pressável: dariam dois focos para a mesma ação. */
function nestedPressables(): ReactTestInstance[] {
  const pressables = screen.UNSAFE_queryAllByType(PressableScale);
  return pressables.filter((pressable) => {
    let parent = pressable.parent;
    while (parent) {
      if (pressables.includes(parent)) return true;
      parent = parent.parent;
    }
    return false;
  });
}

let vibrate: jest.SpyInstance;

beforeEach(() => {
  vibrate = jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('card da grade', () => {
  it('no alcance: um botão só, com o custo no rótulo; o preço lima é só visual', () => {
    const onPress = jest.fn();
    render(
      <RewardCard reward={TICKETS} availability={{ state: 'redeemable' }} onPress={onPress} />,
    );

    const card = screen.getByRole('button', {
      name: 'Par de ingressos. Pra Encher e Derramar. 6.000 pontos.',
    });
    expect(card).toHaveProp('accessibilityHint', 'Abre os detalhes do resgate');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(nestedPressables()).toEqual([]);
    // Só a camada do preço que está à vista; a do contorno, apagada, fica fora do leitor.
    expect(screen.getAllByText('6.000 pts')).toHaveLength(1);
    expect(screen.getAllByText('6.000 pts', hidden)).toHaveLength(2);

    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledWith(TICKETS);
    expect(vibrate).toHaveBeenCalledWith('tap');
  });

  it('fora do alcance: diz quanto falta e continua abrindo o detalhe', () => {
    const onPress = jest.fn();
    render(
      <RewardCard
        reward={SHIRT}
        availability={{ state: 'short', missing: 2_520 }}
        onPress={onPress}
      />,
    );

    const card = screen.getByRole('button', {
      name: 'Camisa oficial. Coleção São João. Faltam 2.520 pontos.',
    });
    expect(screen.getByText('faltam 2.520')).toBeTruthy();
    expect(screen.queryByText('15.000 pts')).toBeNull();
    // Não se diz desativado: o detalhe mostra o que falta e o caminho das missões.
    expect(card).toHaveProp('accessibilityState', expect.objectContaining({ disabled: false }));
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledWith(SHIRT);
  });

  it('esgotada: "Esgotado" no lugar do preço', () => {
    render(<RewardCard reward={VIDEO} availability={{ state: 'soldOut' }} onPress={jest.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Videochamada. 5 min com o artista. Esgotado.' }),
    ).toBeTruthy();
    expect(screen.getByText('Esgotado', hidden)).toBeTruthy();
  });

  it('quando o saldo cai com o card na tela, o preço troca em 250 ms; outra recompensa na célula troca direto', () => {
    const timing = jest.spyOn(Reanimated, 'withTiming');
    const view = render(
      <RewardCard reward={TICKETS} availability={{ state: 'redeemable' }} onPress={jest.fn()} />,
    );
    expect(timing).not.toHaveBeenCalled();

    view.rerender(
      <RewardCard
        reward={TICKETS}
        availability={{ state: 'short', missing: 2_020 }}
        onPress={jest.fn()}
      />,
    );
    expect(timing).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ duration: motion.duration.base }),
    );

    // A FlashList reaproveita a célula para outra recompensa: sem animar.
    timing.mockClear();
    view.rerender(
      <RewardCard reward={VIDEO} availability={{ state: 'redeemable' }} onPress={jest.fn()} />,
    );
    expect(timing).not.toHaveBeenCalled();
  });
});

describe('destaque da loja', () => {
  it('um botão só: título, vagas, show e custo no rótulo', () => {
    const onPress = jest.fn();
    render(
      <FeaturedRewardCard reward={MEET} availability={{ state: 'redeemable' }} onPress={onPress} />,
    );

    const card = screen.getByRole('button', {
      name: 'Meet & greet com o Netto. Só 20 vagas. São João de Irará, 21 de outubro. 10.000 pontos.',
    });
    expect(card).toHaveProp('accessibilityHint', 'Abre os detalhes do resgate');
    expect(nestedPressables()).toEqual([]);
    expect(screen.getByText('Só 20 vagas', hidden)).toBeTruthy();
    expect(screen.getByText('10.000 pts', hidden)).toBeTruthy();
    expect(screen.getByText('São João de Irará · 21 out', hidden)).toBeTruthy();

    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledWith(MEET);
  });

  it('sem saldo, "faltam N" no lugar do custo', () => {
    render(
      <FeaturedRewardCard
        reward={MEET}
        availability={{ state: 'short', missing: 6_020 }}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText('faltam 6.020', hidden)).toBeTruthy();
    expect(screen.queryByText('10.000 pts', hidden)).toBeNull();
  });

  it('esgotado, o selo diz "Esgotado" e as vagas somem', () => {
    const soldOut: Reward = { ...MEET, stock: { remaining: 0, total: 20 }, status: 'soldOut' };
    render(
      <FeaturedRewardCard
        reward={soldOut}
        availability={{ state: 'soldOut' }}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText('Esgotado', hidden)).toBeTruthy();
    expect(screen.queryByText(/vaga/, hidden)).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Meet & greet com o Netto. São João de Irará, 21 de outubro. Esgotado.',
      }),
    ).toBeTruthy();
  });
});

describe('quadro de pontos do resgate', () => {
  it('é lido como um texto só, com os pontos por extenso', () => {
    render(
      <RewardSummary
        lines={[
          { label: 'Custo', points: 8_500, highlight: true },
          { label: 'Seu saldo depois', points: 3_980 },
        ]}
      />,
    );
    expect(
      screen.getByLabelText('Custo: 8.500 pontos. Seu saldo depois: 3.980 pontos.'),
    ).toBeTruthy();
    expect(screen.getByText('8.500 pts', hidden)).toBeTruthy();
  });
});
