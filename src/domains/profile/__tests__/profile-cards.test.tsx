import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Dimensions } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { Path, Polygon } from 'react-native-svg';

import type { FanCentral } from '@/domains/artists';
import { borderWidths, colors, spacing, tints, typography } from '@/theme';
import { withAlpha } from '@/utils/color';

import { AchievementTile } from '../components/achievement-tile';
import { ACHIEVEMENT_SLOTS } from '../consts';
import { CentralRow } from '../components/central-row';
import { LevelBadge } from '../components/level-badge';
import { PointsCard } from '../components/points-card';
import { ProfileHero } from '../components/profile-hero';
import { StatTile } from '../components/stat-tile';
import type { Achievement, MyProgress } from '../types';

// Só a navegação imperativa sai do ar; o resto (tema de navegação) é o de verdade.
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn() },
}));

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

const PURAINHA = { number: 7, name: 'Purainha', minXp: 7_000 };
const XODO = { number: 8, name: 'Xodó', minXp: 15_000 };

const PROGRESS: MyProgress = {
  xp: 12_480,
  level: PURAINHA,
  nextLevel: XODO,
  weekEarned: 840,
  stats: { linksCreated: 63, peopleBrought: 418, seasons: 3 },
};

const hidden = { includeHiddenElements: true } as const;

beforeEach(() => {
  jest.clearAllMocks();
  mockReducedMotion = false;
});

afterEach(() => jest.restoreAllMocks());

describe('PointsCard', () => {
  it('o número grande é o saldo; a barra e o "Faltam" são do XP de nível', () => {
    render(<PointsCard testID="card" balance={3_980} progress={PROGRESS} />);

    expect(screen.getByText('3.980', hidden)).toHaveStyle({ color: colors.points });
    expect(screen.getByText('+840', hidden)).toBeTruthy();
    expect(screen.getByText('2.520 pts', hidden)).toBeTruthy();
    // 68,5% do caminho entre 7.000 e 15.000, mesmo com o saldo menor.
    expect(screen.getByTestId('card')).toHaveProp('accessibilityValue', {
      min: 0,
      max: 100,
      now: 69,
    });
  });

  it('é um elemento só para o leitor, lido como progresso', () => {
    render(<PointsCard testID="card" balance={12_480} progress={PROGRESS} />);
    const card = screen.getByRole('progressbar', {
      name: 'Seus pontos: 12.480. Esta semana: mais 840. Faltam 2.520 pontos para o nível 8, Xodó.',
    });
    expect(card).toHaveProp('accessible', true);
    // A barra lá dentro não é outro foco: o único progresso é o card.
    expect(screen.getAllByRole('progressbar')).toEqual([card]);
  });

  it('com onPress (o extrato, bloco 7), é um botão só, com o mesmo rótulo e a dica', () => {
    const onPress = jest.fn();
    render(<PointsCard testID="card" balance={12_480} progress={PROGRESS} onPress={onPress} />);
    const card = screen.getByRole('button', {
      name: 'Seus pontos: 12.480. Esta semana: mais 840. Faltam 2.520 pontos para o nível 8, Xodó.',
    });
    expect(card).toHaveProp('accessibilityHint', 'Abre o extrato de pontos.');
    // Nada dentro é outro foco: nem a barra, nem outro botão.
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getAllByRole('button')).toEqual([card]);

    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('no nível máximo, a barra enche e a legenda diz que chegou lá', () => {
    render(
      <PointsCard
        testID="card"
        balance={20_000}
        progress={{ ...PROGRESS, xp: 20_000, level: XODO, nextLevel: null }}
      />,
    );
    expect(screen.getByText('Você chegou ao nível máximo', hidden)).toBeTruthy();
    expect(screen.getByTestId('card')).toHaveProp('accessibilityValue', {
      min: 0,
      max: 100,
      now: 100,
    });
  });

  it('a barra e o anel andam na mesma duração e curva', () => {
    const timing = jest.spyOn(Reanimated, 'withTiming');
    render(
      <>
        <PointsCard balance={12_480} progress={PROGRESS} />
        <ProfileHero
          uid="uid-camila"
          name="Camila Ribeiro"
          photoURL={null}
          username="camilarib"
          city={null}
          level={PURAINHA}
          levelFraction={0.685}
        />
      </>,
    );
    const toValue = timing.mock.calls.filter(([value]) => value === 0.685);
    expect(toValue).toHaveLength(2);
    const [bar, ring] = toValue.map(([, config]) => config);
    expect(bar).toEqual(ring);
  });

  it('parados, saldo e semana vão sem tabular: o "1" tabular da Sora tem pé e alarga o número', () => {
    render(<PointsCard balance={12_480} progress={PROGRESS} />);
    for (const text of ['12.480', '+840']) {
      expect(screen.getByText(text, hidden)).not.toHaveStyle({ fontVariant: ['tabular-nums'] });
    }
  });
});

describe('ProfileHero', () => {
  const hero = {
    uid: 'uid-camila',
    name: 'Camila Ribeiro',
    photoURL: null,
    username: 'camilarib',
    city: null,
  } as const;

  it('na subida de nível, o anel recomeça do 0 sem remontar; ganho no mesmo nível só anda', () => {
    const sequence = jest.spyOn(Reanimated, 'withSequence');
    const { rerender } = render(<ProfileHero {...hero} level={PURAINHA} levelFraction={0.685} />);
    rerender(<ProfileHero {...hero} level={PURAINHA} levelFraction={0.7} />);
    expect(sequence).not.toHaveBeenCalled();

    rerender(<ProfileHero {...hero} level={XODO} levelFraction={0.05} />);
    // Só o anel: o selo não festeja sem `celebration`.
    expect(sequence).toHaveBeenCalledTimes(1);
  });

  it('nome, @, cidade e nível num elemento só', () => {
    render(
      <ProfileHero
        testID="hero"
        uid="uid-camila"
        name="Camila Ribeiro"
        photoURL={null}
        username="camilarib"
        city="Feira de Santana, BA"
        level={PURAINHA}
        levelFraction={0.685}
      />,
    );
    const hero = screen.getByLabelText(
      'Camila Ribeiro, @camilarib, Feira de Santana, BA. Nível 7, Purainha.',
    );
    expect(hero).toHaveProp('accessible', true);
    expect(screen.getByText('@camilarib · Feira de Santana, BA', hidden)).toBeTruthy();
    expect(screen.getByText('Nível 7 · Purainha', hidden)).toHaveStyle({
      color: colors.points,
      textTransform: 'uppercase',
    });
    // As iniciais ficam no avatar, fora do leitor.
    expect(screen.getByText('CR', hidden)).toBeTruthy();
  });

  it('sem nome no perfil, mostra o nome de reserva', () => {
    render(
      <ProfileHero
        uid="uid"
        name={null}
        photoURL={null}
        username="fa711224"
        city={null}
        level={PURAINHA}
        levelFraction={0.5}
      />,
    );
    expect(screen.getByLabelText('Fã, @fa711224. Nível 7, Purainha.')).toBeTruthy();
  });

  it('carregando, é um elemento ocupado com "Carregando seu perfil"', () => {
    render(
      <ProfileHero
        testID="hero"
        uid="uid"
        name={null}
        photoURL={null}
        username={null}
        city={null}
        loading
        level={null}
        levelFraction={0}
      />,
    );
    const hero = screen.getByTestId('hero');
    expect(hero).toHaveProp('accessibilityLabel', 'Carregando seu perfil');
    expect(hero).toBeBusy();
  });

  it('com onPress (bloco 9), é um botão só: o rótulo de sempre, a dica e nada tocável dentro', () => {
    const onPress = jest.fn();
    render(
      <ProfileHero
        testID="hero"
        uid="uid-camila"
        name="Camila Ribeiro"
        photoURL={null}
        username="camilarib"
        city="Feira de Santana, BA"
        level={PURAINHA}
        levelFraction={0.685}
        onPress={onPress}
      />,
    );
    const button = screen.getByRole('button', {
      name: 'Camila Ribeiro, @camilarib, Feira de Santana, BA. Nível 7, Purainha.',
    });
    expect(button).toHaveProp('accessibilityHint', 'Abre a edição do perfil');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

/** Opacidade de cada barra da marca no selo: a fixa, ou a do primeiro quadro quando acende. */
function barsOpacity(): number[] {
  return screen.root
    .findAll((node) => node.type === Polygon)
    .map((node) => {
      const animated = node.props.animatedProps as { fillOpacity: number } | undefined;
      return animated ? animated.fillOpacity : (node.props.fillOpacity as number);
    });
}

describe('LevelBadge', () => {
  it('pulsa e volta do rosa ao lima quando o nível sobe diante do fã', () => {
    const sequence = jest.spyOn(Reanimated, 'withSequence');
    const { rerender } = render(<LevelBadge level={PURAINHA} celebration={null} />);
    expect(sequence).not.toHaveBeenCalled();

    rerender(<LevelBadge level={XODO} celebration={1} />);
    // A cor e a escala, uma sequência cada.
    expect(sequence).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Nível 8 · Xodó')).toBeTruthy();
  });

  it('a festa que já estava na tela quando o selo montou não se repete', () => {
    const sequence = jest.spyOn(Reanimated, 'withSequence');
    render(<LevelBadge level={XODO} celebration={3} />);
    expect(sequence).not.toHaveBeenCalled();
    expect(barsOpacity()).toEqual([1, 0.6, 0.3]);
  });

  it('na subida de nível, as barras apagam e acendem de novo, uma depois da outra', () => {
    const { rerender } = render(<LevelBadge level={PURAINHA} celebration={null} />);
    expect(barsOpacity()).toEqual([1, 0.6, 0.3]);
    const delay = jest.spyOn(Reanimated, 'withDelay');

    rerender(<LevelBadge level={XODO} celebration={1} />);
    expect(barsOpacity()).toEqual([0, 0, 0]);
    // O mock refaz o valor a cada render: o acender se confere pelas esperas.
    expect(delay.mock.calls.map(([wait]) => wait)).toEqual([0, 80, 160]);
  });

  it('com reduzir movimento, só o texto troca', () => {
    mockReducedMotion = true;
    const sequence = jest.spyOn(Reanimated, 'withSequence');
    const { rerender } = render(<LevelBadge level={PURAINHA} celebration={null} />);
    rerender(<LevelBadge level={XODO} celebration={1} />);
    expect(sequence).not.toHaveBeenCalled();
    expect(screen.getByText('Nível 8 · Xodó')).toBeTruthy();
  });
});

describe('StatTile', () => {
  it('número e rótulo lidos juntos, sem toque', () => {
    render(<StatTile value={418} label="pessoas trazidas" />);
    expect(screen.getByLabelText('418 pessoas trazidas')).toHaveProp('accessible', true);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('pessoas trazidas', hidden)).toHaveStyle({ color: colors.textMuted });
    expect(screen.getByText('418', hidden)).not.toHaveStyle({ fontVariant: ['tabular-nums'] });
  });
});

describe('AchievementTile', () => {
  const unlocked: Achievement = {
    id: 'top-20',
    title: 'Top 20',
    icon: 'trophy',
    tone: 'points',
    unlockedAt: '2026-09-24T20:00:00.000Z',
  };

  it('conquistada: tingida na cor do assunto, com o rótulo em branco', () => {
    render(<AchievementTile testID="tile" achievement={unlocked} />);
    const tile = screen.getByLabelText('Top 20, conquistada');
    expect(tile).toHaveStyle({
      backgroundColor: withAlpha(colors.points, tints.soft.fill),
      borderColor: withAlpha(colors.points, tints.soft.border),
    });
    expect(screen.getByText('Top 20', hidden)).toHaveStyle({ color: colors.text });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a taça do "Top 20" é a fina do protótipo, e não o troféu do lucide', () => {
    render(<AchievementTile achievement={unlocked} />);
    const cup = screen.root.findAll(
      (node) => node.type === Path && node.props.d === 'M8 4h8v5a4 4 0 0 1-8 0z',
    );
    expect(cup).toHaveLength(1);
  });

  it('com a fonte maior, a peça não fica mais baixa que o quadrado da fonte padrão', () => {
    // O Jest abre com a fonte do sistema a 200%.
    const { width } = Dimensions.get('window');
    const gaps = (ACHIEVEMENT_SLOTS - 1) * spacing.tileGap;
    render(<AchievementTile testID="tile" achievement={unlocked} />);
    expect(screen.getByTestId('tile')).toHaveStyle({
      minHeight: (width - 2 * spacing.gutter - gaps) / ACHIEVEMENT_SLOTS,
    });
  });

  it('bloqueada: borda tracejada e rótulo em textMuted, nunca abaixo de .5', () => {
    render(
      <AchievementTile
        testID="tile"
        achievement={{ ...unlocked, id: 'backstage', title: 'Backstage', unlockedAt: null }}
      />,
    );
    expect(screen.getByLabelText('Backstage, bloqueada')).toHaveStyle({
      borderStyle: 'dashed',
      borderColor: colors.borderOutline,
      borderWidth: borderWidths.default,
      backgroundColor: colors.surface,
    });
    expect(screen.getByText('Backstage', hidden)).toHaveStyle({ color: colors.textMuted });
  });
});

describe('CentralRow', () => {
  const NETTO: FanCentral = {
    artistId: 'nettobrito',
    name: 'Netto Brito',
    shortName: null,
    photoURL: null,
    fanCount: 412_000,
    fanRank: 12,
    seasonPoints: 4_120,
  };

  it('a linha toda é um alvo só, com a posição e os pontos no rótulo', () => {
    render(<CentralRow central={NETTO} />);
    const row = screen.getByRole('button', {
      name: 'Netto Brito, 12º lugar entre 412 mil fãs, 4.120 pontos na temporada.',
    });
    expect(row).toHaveProp('accessibilityHint', 'Abre a central');
    // Os pontos ficam visíveis, em lima, e fora do leitor (já estão no rótulo).
    expect(screen.getByText('4.120', hidden)).toHaveStyle({ color: colors.points });
    // Sora 800 12 do protótipo: `chip`, sem tabular.
    expect(screen.getByText('4.120', hidden)).toHaveStyle({ fontSize: typography.chip.fontSize });
    expect(screen.getByText('4.120', hidden)).not.toHaveStyle({ fontVariant: ['tabular-nums'] });
    expect(screen.queryByText('4.120')).toBeNull();
  });

  it('tocar abre a página do artista', () => {
    render(<CentralRow central={NETTO} />);
    fireEvent.press(screen.getByRole('button'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/artista/[artistaId]',
      params: { artistaId: 'nettobrito' },
    });
  });

  it('sem posição na central, não mostra pontos', () => {
    render(
      <CentralRow
        central={{
          ...NETTO,
          artistId: 'juninhomoraes',
          name: 'Juninho Moraes',
          fanCount: 141_000,
          fanRank: null,
          seasonPoints: 0,
        }}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Juninho Moraes, ainda sem posição, entre 141 mil fãs.' }),
    ).toBeTruthy();
    expect(screen.getByText('Sem posição ainda · 141 mil fãs', hidden)).toBeTruthy();
    expect(screen.queryByText('0', hidden)).toBeNull();
  });

  it('sem posição e com pontos (o servidor, até o bloco 8): os pontos à direita e no rótulo', () => {
    render(<CentralRow central={{ ...NETTO, fanRank: null, fanCount: 1 }} />);
    expect(
      screen.getByRole('button', {
        name: 'Netto Brito, ainda sem posição, 1 fã, 4.120 pontos na temporada.',
      }),
    ).toBeTruthy();
    expect(screen.getByText('Sem posição ainda · 1 fã', hidden)).toBeTruthy();
    expect(screen.getByText('4.120', hidden)).toHaveStyle({ color: colors.points });
  });
});
