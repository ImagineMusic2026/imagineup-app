import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import type { ReactTestInstance } from 'react-test-renderer';

import { PressableScale } from '@/components/pressable-scale';
import { haptics } from '@/services/haptics';
import { motion } from '@/theme';

import { FeaturedRewardCard } from '../components/featured-reward-card';
import { DetailsActions, DetailsBody, SuccessBody } from '../components/redeem-steps';
import { RewardCard } from '../components/reward-card';
import { RewardSummary } from '../components/reward-summary';
import { RewardsLegal } from '../components/rewards-legal';
import { buildRewardsFixture } from '../fixtures';
import type { Reward, RewardRedemption } from '../types';

// As fixtures da loja leem os shows da agenda de exemplo, que chegam ao
// domínio das missões (com o axios e o Firebase): o build ESM do Firebase não
// roda no Jest.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));

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

// --- Bloco 10: o status do pedido, o limite e o aviso da Apple -------------------------

describe('pedido no detalhe da recompensa', () => {
  const redemption = (extra: Partial<RewardRedemption>): RewardRedemption => ({
    id: 'UP-4KD9TM',
    code: 'UP-4KD9TM',
    status: 'requested',
    statusAt: new Date(2026, 9, 2, 18, 0).toISOString(),
    points: 6_000,
    refundedPoints: 0,
    instructions: 'Retire na bilheteria com este código.',
    refusalReason: null,
    redeemedAt: new Date(2026, 8, 30, 18, 0).toISOString(),
    ...extra,
  });

  function renderDetails(redemptions: RewardRedemption[]) {
    render(
      <DetailsBody
        reward={{ ...TICKETS, redemptions }}
        availability={{ state: 'redeemable' }}
        balance={12_480}
        headingRef={{ current: null }}
      />,
    );
  }

  it.each([
    ['requested', 'Solicitado em 2 out', 'Solicitado em 2 de outubro'],
    ['approved', 'Aprovado em 2 out', 'Aprovado em 2 de outubro'],
  ] as const)('%s: o código com o status, e as instruções', (status, text, spoken) => {
    renderDetails([redemption({ status })]);
    expect(screen.getByRole('header', { name: 'Seus resgates' })).toBeTruthy();
    expect(screen.getByLabelText(`Código do resgate: UP-4KD9TM. ${spoken}.`)).toBeTruthy();
    expect(screen.getByText(text, hidden)).toBeTruthy();
    expect(screen.getByText('Retire na bilheteria com este código.')).toBeTruthy();
  });

  it('entregue: só o código e o status, sem as instruções', () => {
    renderDetails([redemption({ status: 'delivered' })]);
    expect(
      screen.getByLabelText('Código do resgate: UP-4KD9TM. Entregue em 2 de outubro.'),
    ).toBeTruthy();
    expect(screen.queryByText(/bilheteria/)).toBeNull();
  });

  it('recusado: o motivo e os pontos que voltaram de fato, sem as instruções', () => {
    renderDetails([
      redemption({ status: 'refused', refusalReason: 'Show cancelado.', refundedPoints: 6_000 }),
    ]);
    expect(
      screen.getByLabelText('Código do resgate: UP-4KD9TM. Recusado em 2 de outubro.'),
    ).toBeTruthy();
    expect(
      screen.getByText('Motivo: Show cancelado.\nOs 6.000 pontos voltaram para o seu saldo.'),
    ).toBeTruthy();
    expect(screen.queryByText(/bilheteria/)).toBeNull();
  });

  it('recusado sem motivo e sem pontos de volta (0): nem o motivo nem a frase dos pontos', () => {
    renderDetails([redemption({ status: 'refused', refundedPoints: 0 })]);
    expect(screen.queryByText(/Motivo/)).toBeNull();
    expect(screen.queryByText(/voltaram/)).toBeNull();
  });

  it('o limite atingido: o botão desligado diz "Você já resgatou", ou o número com limite maior', () => {
    const view = render(
      <DetailsActions
        reward={{ ...TICKETS, perFanLimit: 1, limitReached: true }}
        availability={{ state: 'limitReached' }}
        online
        notice={null}
        noticeRef={{ current: null }}
        onRedeem={jest.fn()}
        onSeeMissions={jest.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Você já resgatou' })).toBeDisabled();
    expect(screen.queryByText('Ver missões')).toBeNull();
    view.rerender(
      <DetailsActions
        reward={{ ...TICKETS, perFanLimit: 2, limitReached: true }}
        availability={{ state: 'limitReached' }}
        online
        notice="limitReached"
        noticeRef={{ current: null }}
        onRedeem={jest.fn()}
        onSeeMissions={jest.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Limite de 2 resgates atingido' })).toBeDisabled();
    expect(
      screen.getByLabelText('Você chegou ao limite de resgates desta recompensa.'),
    ).toBeTruthy();
  });

  it('o sucesso diz onde acompanhar o pedido', () => {
    render(
      <SuccessBody
        reward={VIDEO}
        result={{
          redemptionId: 'UP-C3NWPB',
          rewardId: 'videochamada',
          code: 'UP-C3NWPB',
          balance: 3_980,
          instructions: 'A equipe fala com você.',
          redeemedAt: new Date(2026, 8, 29, 20).toISOString(),
          status: 'requested',
        }}
        headingRef={{ current: null }}
      />,
    );
    expect(screen.getByText('Você acompanha o pedido nesta recompensa, na loja.')).toBeTruthy();
  });
});

describe('o limite do fã nos cards', () => {
  it('na grade: "Resgatado" no lugar do preço, no desenho do esgotado', () => {
    render(
      <RewardCard
        reward={{ ...TICKETS, limitReached: true }}
        availability={{ state: 'limitReached' }}
        onPress={jest.fn()}
      />,
    );
    expect(
      screen.getByRole('button', {
        name: 'Par de ingressos. Pra Encher e Derramar. Limite de resgates atingido.',
      }),
    ).toBeTruthy();
    expect(screen.getByText('Resgatado', hidden)).toBeTruthy();
  });

  it('no destaque: o selo "Resgatado", sem o custo', () => {
    render(
      <FeaturedRewardCard
        reward={{ ...MEET, limitReached: true }}
        availability={{ state: 'limitReached' }}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText('Resgatado', hidden)).toBeTruthy();
    expect(screen.queryByText('10.000 pts', hidden)).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Meet & greet com o Netto. Só 20 vagas. São João de Irará, 21 de outubro. Limite de resgates atingido.',
      }),
    ).toBeTruthy();
  });
});

describe('aviso da Apple e regulamento no pé da loja', () => {
  const NOTICE =
    'As recompensas são oferecidas pela Imagine Music. A Apple não patrocina nem participa delas de nenhuma forma.';

  it('o aviso aparece sempre; sem o endereço, sem o link', () => {
    render(<RewardsLegal rulesUrl={null} />);
    expect(screen.getByText(NOTICE)).toBeTruthy();
    expect(screen.queryByText('Regulamento')).toBeNull();
  });

  it('com o endereço, o link "Regulamento" dentro do texto, com a dica', () => {
    render(<RewardsLegal rulesUrl="https://imagineup.com.br/regulamento/" />);
    const link = screen.getByRole('link', { name: 'Regulamento' });
    expect(link).toHaveProp('accessibilityHint', 'Abre o regulamento das recompensas');
    expect(screen.getByText(/^As recompensas são oferecidas pela Imagine Music\./)).toBeTruthy();
  });
});
