import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  AccessibilityInfo,
  Dimensions,
  StyleSheet,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { PressableScale } from '@/components/pressable-scale';
import { haptics } from '@/services/haptics';
import { colors } from '@/theme';

import type { RankingSelf } from '../components/entry-avatar';
import { MyRankCard } from '../components/my-rank-card';
import { Podium, podiumStepHeights } from '../components/podium';
import { RankingRow } from '../components/ranking-row';
import { SeasonLine } from '../components/season-line';
import type { LeaderboardEntry, MyRank, Season } from '../types';

const hidden = { includeHiddenElements: true } as const;

// Terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);

const SELF: RankingSelf = { id: 'uid-camila', name: 'Camila Ribeiro', photoUrl: null };

function entry(overrides: Partial<LeaderboardEntry>): LeaderboardEntry {
  return {
    position: 4,
    userId: 'fa-maria-clara',
    displayName: 'Maria Clara Souza',
    photoURL: null,
    city: 'Salvador, BA',
    points: 6_844,
    change: 3,
    isMe: false,
    ...overrides,
  };
}

const PODIUM: LeaderboardEntry[] = [
  entry({ position: 1, userId: 'fa-thalita', displayName: 'Thalita Santos', points: 9_140 }),
  entry({ position: 2, userId: 'fa-davi', displayName: 'Davi Lima', points: 7_902 }),
  entry({ position: 3, userId: 'fa-jean', displayName: 'Jean Pereira', points: 7_318 }),
];

const SEASON: Season = {
  id: 'temporada-sao-joao',
  name: 'São João',
  startsAt: new Date(2026, 8, 11).toISOString(),
  endsAt: new Date(2026, 9, 11, 20, 0).toISOString(),
  status: 'active',
  leaderTitle: null,
};

function minHeight(node: ReactTestInstance): number | undefined {
  return (StyleSheet.flatten(node.props.style) as ViewStyle).minHeight as number | undefined;
}

// Bordas (1 + 1) e padding (12 + 14) do degrau, fora o conteúdo.
const STEP_CHROME = 28;

/** A altura mínima dos degraus, do 1º ao 3º. */
const stepHeights = () =>
  [1, 2, 3].map((place) => minHeight(screen.getByTestId(`podium-${place}-step`)));

function textColor(node: ReactTestInstance): string | undefined {
  return (StyleSheet.flatten(node.props.style) as TextStyle).color as string | undefined;
}

function translateX(node: ReactTestInstance): number {
  const style = StyleSheet.flatten(node.props.style) as ViewStyle;
  const transform = (style.transform ?? []) as { translateX?: number }[];
  return transform.find((step) => step.translateX !== undefined)?.translateX ?? 0;
}

/** Pressáveis que moram dentro de outro pressável (a regra do workspace proíbe). */
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

beforeEach(() => {
  // O AccessibilityInfo do Jest já é um mock: o spyOn devolve o mesmo, com as chamadas de antes.
  jest.clearAllMocks();
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('pódio', () => {
  it('o leitor lê 1º, 2º e 3º, com o nome curto de todos e o título neutro do 1º', () => {
    render(<Podium entries={PODIUM} self={SELF} leaderTitle={null} testID="podium" />);

    expect(screen.getAllByLabelText(/lugar/).map((node) => node.props.accessibilityLabel)).toEqual([
      '1º lugar, Thalita S., 9.140 pontos, Líder da temporada',
      '2º lugar, Davi L., 7.902 pontos',
      '3º lugar, Jean P., 7.318 pontos',
    ]);
    expect(screen.getByText('Thalita S.', hidden)).toBeTruthy();
    expect(screen.getByText('Líder da temporada', hidden)).toBeTruthy();
    // Nada de título de gênero nem de mês.
    expect(screen.queryByText(/rainha/i, hidden)).toBeNull();
  });

  it('na tela, o 2º fica à esquerda e o 1º no meio, sem mudar a ordem de leitura', () => {
    render(<Podium entries={PODIUM} self={SELF} leaderTitle={null} testID="podium" />);

    expect(translateX(screen.getByTestId('podium-1'))).toBeGreaterThan(0);
    expect(translateX(screen.getByTestId('podium-2'))).toBeLessThan(0);
    expect(translateX(screen.getByTestId('podium-3'))).toBe(0);
  });

  it('o título do 1º pode vir do painel', () => {
    render(<Podium entries={PODIUM} self={SELF} leaderTitle="Rainha do São João" />);
    expect(
      screen.getByLabelText('1º lugar, Thalita S., 9.140 pontos, Rainha do São João'),
    ).toBeTruthy();
  });

  it('com menos de três pessoas, os degraus que faltam ficam vagos', () => {
    render(<Podium entries={PODIUM.slice(0, 1)} self={SELF} leaderTitle={null} />);
    expect(screen.getByLabelText('2º lugar, vago')).toBeTruthy();
    expect(screen.getByLabelText('3º lugar, vago')).toBeTruthy();
  });

  it('os degraus fazem escada pelo conteúdo: 117 / 101 / 87 na fonte padrão', () => {
    expect(podiumStepHeights(1)).toEqual({ 1: 117, 2: 101, 3: 87 });
    // Com a fonte menor ou maior, o 2º segue 14 acima do 3º e o 1º 16 acima do 2º (ou mais).
    for (const scale of [0.85, 1.3, 2]) {
      const steps = podiumStepHeights(scale);
      expect(steps[2] - steps[3]).toBeGreaterThanOrEqual(14);
      expect(steps[1] - steps[2]).toBeGreaterThanOrEqual(16);
    }

    // No Jest, a fonte do sistema está em 2 (200%).
    const steps = podiumStepHeights(Dimensions.get('window').fontScale);
    render(<Podium entries={PODIUM} self={SELF} leaderTitle={null} testID="podium" />);
    expect(stepHeights()).toEqual([steps[1], steps[2], steps[3]]);
  });

  it('um nome em duas linhas no 3º empurra o 2º e o 1º, e a escada fica', () => {
    const before = podiumStepHeights(Dimensions.get('window').fontScale);
    render(<Podium entries={PODIUM} self={SELF} leaderTitle={null} testID="podium" />);

    // O nome do 3º quebrou: o conteúdo mediu 18 a mais que a conta de uma linha.
    fireEvent(screen.getByTestId('podium-3-content'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 97, height: before[3] - STEP_CHROME + 18 } },
    });

    const [first = 0, second = 0, third = 0] = stepHeights();
    expect(third).toBe(before[3] + 18);
    expect(second - third).toBe(14);
    expect(first - second).toBeGreaterThanOrEqual(16);
  });

  it('com onOpen, a coluna de outro fã é um botão que abre o perfil; a escada e a ordem não mudam', () => {
    const onOpen = jest.fn();
    render(
      <Podium
        entries={PODIUM.slice(0, 2)}
        self={SELF}
        leaderTitle={null}
        onOpen={onOpen}
        testID="podium"
      />,
    );

    // Três rótulos, na ordem 1, 2, 3: o de fora só anima, o de dentro tem o rótulo.
    expect(screen.getAllByLabelText(/lugar/).map((node) => node.props.accessibilityLabel)).toEqual([
      '1º lugar, Thalita S., 9.140 pontos, Líder da temporada',
      '2º lugar, Davi L., 7.902 pontos',
      '3º lugar, vago',
    ]);
    const first = screen.getByRole('button', {
      name: '1º lugar, Thalita S., 9.140 pontos, Líder da temporada',
    });
    expect(first.props.accessibilityHint).toBe('Abre o perfil de Thalita S.');
    // A vaga continua estática.
    expect(screen.queryByRole('button', { name: '3º lugar, vago' })).toBeNull();
    expect(nestedPressables()).toEqual([]);
    // O `translateX` fica no `Animated.View` de fora, e o `scale` do toque, no de dentro.
    expect(translateX(screen.getByTestId('podium-1'))).toBeGreaterThan(0);
    expect(translateX(screen.getByTestId('podium-2'))).toBeLessThan(0);

    fireEvent.press(first);
    expect(onOpen).toHaveBeenCalledWith(PODIUM[0]);
    expect(haptics.trigger).toHaveBeenCalledWith('tap');
  });

  it('o próprio fã no pódio aparece como "Você"', () => {
    const withMe = [
      PODIUM[0],
      entry({ position: 2, userId: 'me', displayName: null, isMe: true, points: 7_902 }),
      PODIUM[2],
    ].filter((item): item is LeaderboardEntry => item !== undefined);
    const onOpen = jest.fn();
    render(<Podium entries={withMe} self={SELF} leaderTitle={null} onOpen={onOpen} />);
    expect(screen.getByLabelText('2º lugar, Você, 7.902 pontos')).toBeTruthy();
    // A coluna "Você" não abre perfil nenhum: fica estática, com o rótulo.
    expect(screen.queryByRole('button', { name: '2º lugar, Você, 7.902 pontos' })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});

describe('linha do ranking', () => {
  it('sem onPress, é um elemento só, com a variação por extenso, e não é tocável', () => {
    render(<RankingRow entry={entry({})} self={SELF} />);

    expect(
      screen.getByLabelText('4º, Maria Clara Souza, Salvador, BA, 6.844 pontos, subiu 3 posições'),
    ).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    // A seta e o número moram dentro do elemento da linha. Subida em branco cheio.
    expect(textColor(screen.getByText('3', hidden))).toBe(colors.text);
  });

  it('com onPress, a linha de outro fã é um botão só, com a dica, e os pontos ficam dentro, ocultos', () => {
    const onPress = jest.fn();
    render(<RankingRow entry={entry({})} self={SELF} onPress={onPress} testID="row" />);

    const row = screen.getByRole('button', {
      name: '4º, Maria Clara Souza, Salvador, BA, 6.844 pontos, subiu 3 posições',
    });
    expect(row.props.accessibilityHint).toBe('Abre o perfil de Maria Clara Souza');
    // Os pontos e a seta, no `trailing`, fora do leitor e do toque.
    const trailing = screen.getByTestId('row-trailing', hidden);
    expect(trailing.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(trailing.props.pointerEvents).toBe('none');
    expect(nestedPressables()).toEqual([]);

    fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(haptics.trigger).toHaveBeenCalledWith('tap');
  });

  it('a linha "Você" fica estática mesmo com onPress', () => {
    const onPress = jest.fn();
    render(
      <RankingRow
        entry={entry({ position: 12, userId: 'me', displayName: null, isMe: true })}
        self={SELF}
        onPress={onPress}
      />,
    );
    expect(screen.getByLabelText(/^12º, Você/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('sem cidade e sem variação, mostra só o nome e os pontos', () => {
    render(
      <RankingRow
        entry={entry({
          position: 10,
          city: null,
          change: 0,
          displayName: 'Júlia Ramos',
          points: 4_960,
        })}
        self={SELF}
      />,
    );

    expect(screen.getByLabelText('10º, Júlia Ramos, 4.960 pontos')).toBeTruthy();
    expect(screen.queryByText('Salvador, BA', hidden)).toBeNull();
  });

  it('a linha do fã diz "Você", com a queda por extenso', () => {
    render(
      <RankingRow
        entry={entry({
          position: 41,
          userId: 'me',
          displayName: null,
          city: null,
          points: 2_980,
          change: -2,
          isMe: true,
        })}
        self={SELF}
      />,
    );
    expect(screen.getByLabelText('41º, Você, 2.980 pontos, caiu 2 posições')).toBeTruthy();
    expect(screen.getByText('Você', hidden)).toBeTruthy();
    // Queda apagada, sem lima (pontos) nem rosa (ação).
    expect(textColor(screen.getByText('2', hidden))).toBe(colors.textMuted);
  });
});

describe('card "Você"', () => {
  const OUTSIDE_TOP: MyRank = {
    position: 12,
    points: 4_120,
    target: { kind: 'top', position: 10, pointsLeft: 840 },
  };

  it('fora do top 10: diz quanto falta e, tocado, rola até a linha do fã', () => {
    const onPress = jest.fn();
    render(
      <MyRankCard
        myRank={OUTSIDE_TOP}
        seasonOver={false}
        self={SELF}
        visible
        onPress={onPress}
        accessibilityHint="Mostra sua linha no ranking"
        scopeKey="global"
      />,
    );

    const card = screen.getByRole('button', {
      name: 'Você, 12º lugar, 4.120 pontos. Faltam 840 pontos para entrar no top 10.',
    });
    expect(screen.getByText('840 pts para entrar no top 10', hidden)).toBeTruthy();
    expect(nestedPressables()).toEqual([]);
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(haptics.trigger).toHaveBeenCalledWith('tap');
  });

  it('numa central de que o fã não é membro: chama para entrar, com os pontos de lá, sem botão', () => {
    render(
      <MyRankCard
        myRank={{ position: null, points: 750, target: null, member: false }}
        seasonOver={false}
        self={SELF}
        visible
        scopeKey="artist:nenho"
      />,
    );
    expect(screen.getByLabelText('Você. Entre na central para aparecer no ranking.')).toBeTruthy();
    expect(screen.getByText('Entre na central para aparecer no ranking', hidden)).toBeTruthy();
    expect(screen.getByText('750', hidden)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('sem pontos: só informa, sem botão', () => {
    render(
      <MyRankCard
        myRank={{ position: null, points: 0, target: null }}
        seasonOver={false}
        self={SELF}
        visible
        scopeKey="artist:juninhomoraes"
      />,
    );
    expect(screen.getByLabelText('Você. Ganhe pontos para entrar no ranking.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('buscando a linha do fã: ocupado para o leitor, com o indicador no lugar dos pontos', () => {
    render(
      <MyRankCard
        myRank={OUTSIDE_TOP}
        seasonOver={false}
        self={SELF}
        visible
        onPress={jest.fn()}
        busy
        scopeKey="artist:nenho"
      />,
    );
    const card = screen.getByRole('button', {
      name: 'Você, 12º lugar, 4.120 pontos. Faltam 840 pontos para entrar no top 10.',
    });
    expect(card.props.accessibilityState).toEqual(expect.objectContaining({ busy: true }));
    expect(screen.queryByText('4.120', hidden)).toBeNull();
  });

  it('carregando: a posição em "·" e ocupado para o leitor', () => {
    render(
      <MyRankCard
        myRank={undefined}
        seasonOver={false}
        self={SELF}
        visible
        onPress={jest.fn()}
        scopeKey="global"
      />,
    );
    const card = screen.getByLabelText('Carregando sua posição');
    expect(card.props.accessibilityState).toEqual({ busy: true });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('escondido (a linha do fã está à vista), sai do leitor e do toque', () => {
    render(
      <MyRankCard
        myRank={OUTSIDE_TOP}
        seasonOver={false}
        self={SELF}
        visible={false}
        onPress={jest.fn()}
        scopeKey="global"
        testID="me"
      />,
    );
    const container = screen.getByTestId('me', hidden);
    expect(container.props.accessibilityElementsHidden).toBe(true);
    expect(container.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(container.props.pointerEvents).toBe('none');
  });

  it('subir de posição no mesmo recorte vibra "rankUp"; trocar de chip não', () => {
    const props = { seasonOver: false, self: SELF, visible: true } as const;
    const view = render(<MyRankCard {...props} myRank={OUTSIDE_TOP} scopeKey="global" />);

    view.rerender(
      <MyRankCard {...props} myRank={{ ...OUTSIDE_TOP, position: 41 }} scopeKey="artist:nenho" />,
    );
    view.rerender(
      <MyRankCard
        {...props}
        myRank={{ ...OUTSIDE_TOP, position: 12 }}
        scopeKey="artist:nettobrito"
      />,
    );
    expect(haptics.trigger).not.toHaveBeenCalledWith('rankUp');

    view.rerender(
      <MyRankCard
        {...props}
        myRank={{ ...OUTSIDE_TOP, position: 11 }}
        scopeKey="artist:nettobrito"
      />,
    );
    expect(haptics.trigger).toHaveBeenCalledWith('rankUp');
    expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
      'Você subiu para o 11º lugar.',
      { queue: true },
    );
  });

  it('subir com a tela fora de foco não festeja; ao voltar, vibra e anuncia uma vez', () => {
    const props = { seasonOver: false, self: SELF, visible: true, scopeKey: 'global' } as const;
    const view = render(<MyRankCard {...props} myRank={OUTSIDE_TOP} />);

    // O "Eu vou" da agenda invalidou o ranking com o fã em outra tela.
    view.rerender(
      <MyRankCard {...props} myRank={{ ...OUTSIDE_TOP, position: 11 }} screenFocused={false} />,
    );
    expect(haptics.trigger).not.toHaveBeenCalledWith('rankUp');
    expect(AccessibilityInfo.announceForAccessibilityWithOptions).not.toHaveBeenCalled();

    view.rerender(
      <MyRankCard {...props} myRank={{ ...OUTSIDE_TOP, position: 11 }} screenFocused />,
    );
    view.rerender(
      <MyRankCard {...props} myRank={{ ...OUTSIDE_TOP, position: 11 }} screenFocused />,
    );
    expect(jest.mocked(haptics.trigger).mock.calls).toEqual([['rankUp']]);
    expect(jest.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mock.calls).toEqual([
      ['Você subiu para o 11º lugar.', { queue: true }],
    ]);
  });
});

describe('linha da temporada', () => {
  it('conta os dias até o fim', () => {
    render(<SeasonLine season={SEASON} now={NOW} />);
    expect(screen.getByText('Temporada de São João · encerra em 12 dias')).toBeTruthy();
  });

  it('carregando, é uma barra fora do leitor', () => {
    render(<SeasonLine season={undefined} now={NOW} />);
    expect(screen.queryByText(/Temporada/)).toBeNull();
  });

  it('sem temporada, diz que não há nenhuma', () => {
    render(<SeasonLine season={null} now={NOW} />);
    expect(screen.getByText('Nenhuma temporada em andamento')).toBeTruthy();
  });
});
