import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Dimensions, StyleSheet, Text } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { Polygon } from 'react-native-svg';

import type { FanCentral } from '@/domains/artists';
import { colors, layout, typography } from '@/theme';

import { AchievementsRow, AchievementTile } from '../components/achievement-tile';
import { CentralRow } from '../components/central-row';
import { LevelBadge } from '../components/level-badge';
import { LevelProgress } from '../components/level-progress';
import { ProfileActions } from '../components/profile-actions';
import { ProfileHero } from '../components/profile-hero';
import { ProfileNumbers } from '../components/profile-numbers';
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

const systemWindow = Dimensions.get('window');
const setFontScale = (fontScale: number) =>
  Dimensions.set({ window: { ...systemWindow, fontScale } });

afterEach(() => act(() => setFontScale(systemWindow.fontScale)));

describe('ProfileNumbers', () => {
  const STATS = PROGRESS.stats;

  it('o saldo em lima, as pessoas e as temporadas; cada número é um foco só', () => {
    render(<ProfileNumbers balance={3_980} stats={STATS} onPointsPress={jest.fn()} />);

    expect(screen.getByText('3.980', hidden)).toHaveStyle({ color: colors.points });
    expect(screen.getByText('418', hidden)).toHaveStyle({ color: colors.text });
    expect(screen.getByLabelText('418 convidados')).toHaveProp('accessible', true);
    expect(screen.getByLabelText('3 temporadas')).toHaveProp('accessible', true);
    // Os links criados e os ganhos da semana ficam fora da 1e.
    expect(screen.queryByText(/links?/, hidden)).toBeNull();
    expect(screen.queryByText('+840', hidden)).toBeNull();
  });

  it('o de pontos é o botão do extrato: o número e o rótulo, a dica e nada tocável dentro', () => {
    const onPointsPress = jest.fn();
    render(<ProfileNumbers balance={12_480} stats={STATS} onPointsPress={onPointsPress} />);

    const points = screen.getByRole('button', { name: '12.480 pontos' });
    expect(points).toHaveProp('accessibilityHint', 'Abre o extrato de pontos.');
    expect(screen.getAllByRole('button')).toEqual([points]);
    fireEvent.press(points);
    expect(onPointsPress).toHaveBeenCalledTimes(1);
  });

  it('no singular: "1 ponto", "1 convidado", "1 temporada"', () => {
    render(
      <ProfileNumbers
        balance={1}
        stats={{ linksCreated: 1, peopleBrought: 1, seasons: 1 }}
        onPointsPress={jest.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '1 ponto' })).toBeTruthy();
    expect(screen.getByLabelText('1 convidado')).toBeTruthy();
    expect(screen.getByLabelText('1 temporada')).toBeTruthy();
  });

  it('parado, o saldo vai sem tabular: o "1" tabular da Sora tem pé e alarga o número', () => {
    render(<ProfileNumbers balance={12_480} stats={STATS} onPointsPress={jest.fn()} />);
    expect(screen.getByText('12.480', hidden)).not.toHaveStyle({ fontVariant: ['tabular-nums'] });
  });

  it('alinhados à esquerda e espalhados, cada coluna da largura do que mostra', () => {
    render(
      <ProfileNumbers testID="numbers" balance={12_480} stats={STATS} onPointsPress={jest.fn()} />,
    );
    expect(screen.getByTestId('numbers')).toHaveStyle({
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    });
    expect(screen.getByText('convidados', hidden)).toHaveStyle({ color: colors.textSecondary });
    for (const id of [
      'profile-stat-points',
      'profile-stat-peopleBrought',
      'profile-stat-seasons',
    ]) {
      const cell = screen.getByTestId(id);
      expect(cell).toHaveStyle({ alignItems: 'flex-start' });
      // Nenhuma coluna estica: a largura é a do que ela mostra. O estilo chega
      // ao host como lista: achatado, a conferência vale.
      const flat = StyleSheet.flatten(cell.props.style);
      expect(flat).not.toHaveProperty('flex');
      expect(flat).not.toHaveProperty('flexGrow');
    }
  });

  it('o botão de pontos tem o alvo de 44 por 44 mesmo com o saldo curto ("0 pontos")', () => {
    render(<ProfileNumbers balance={0} stats={STATS} onPointsPress={jest.fn()} />);
    expect(screen.getByRole('button', { name: '0 pontos' })).toHaveStyle({
      minWidth: layout.minTouchTarget,
      minHeight: layout.minTouchTarget,
    });
  });
});

describe('LevelProgress', () => {
  it('o selo, a barra e o "Faltam" do XP de nível, num elemento lido como progresso', () => {
    render(<LevelProgress testID="level" progress={PROGRESS} />);

    const level = screen.getByRole('progressbar', {
      name: 'Faltam 2.520 pontos para o nível 8, Xodó',
    });
    // 68,5% do caminho entre 7.000 e 15.000.
    expect(level).toHaveProp('accessibilityValue', { min: 0, max: 100, now: 69 });
    // A barra lá dentro não é outro foco.
    expect(screen.getAllByRole('progressbar')).toEqual([level]);
    expect(screen.getByText('2.520 pts', hidden)).toBeTruthy();
    expect(screen.getByText('Nível 7 · Purainha', hidden)).toHaveStyle({
      color: colors.points,
      textTransform: 'uppercase',
    });
  });

  it('no nível máximo, a barra enche e a legenda diz que chegou lá', () => {
    render(
      <LevelProgress
        testID="level"
        progress={{ ...PROGRESS, xp: 20_000, level: XODO, nextLevel: null }}
      />,
    );
    expect(screen.getByText('Você chegou ao nível máximo', hidden)).toBeTruthy();
    expect(screen.getByTestId('level')).toHaveProp('accessibilityValue', {
      min: 0,
      max: 100,
      now: 100,
    });
  });

  it('a barra e o anel andam na mesma duração e curva', () => {
    const timing = jest.spyOn(Reanimated, 'withTiming');
    render(
      <>
        <LevelProgress progress={PROGRESS} />
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
});

describe('ProfileActions', () => {
  it('"Editar perfil" e "Convidar amigos", cada um com a dica', () => {
    render(<ProfileActions />);

    const edit = screen.getByRole('button', { name: 'Editar perfil' });
    expect(edit).toHaveProp('accessibilityHint', 'Abre a edição do perfil');
    fireEvent.press(edit);
    expect(router.push).toHaveBeenCalledWith('/editar-perfil');

    const invite = screen.getByRole('button', { name: 'Convidar amigos' });
    expect(invite).toHaveProp('accessibilityHint', 'Abre o seu link de convite');
    fireEvent.press(invite);
    expect(router.push).toHaveBeenLastCalledWith('/convidar');
  });

  it.each([1, 1.15])('a %sx, lado a lado e da mesma largura', (scale) => {
    setFontScale(scale);
    render(<ProfileActions testID="actions" />);
    expect(screen.getByTestId('actions')).toHaveStyle({ flexDirection: 'row' });
    for (const id of ['profile-edit', 'profile-invite']) {
      expect(screen.getByTestId(id)).toHaveStyle({ flex: 1 });
    }
  });

  it.each([Math.fround(1.3), 2])(
    'a %sx, lado a lado, cada um da largura do rótulo, e o que não cabe desce',
    (scale) => {
      setFontScale(scale);
      render(<ProfileActions testID="actions" />);
      expect(screen.getByTestId('actions')).toHaveStyle({ flexDirection: 'row', flexWrap: 'wrap' });
      for (const id of ['profile-edit', 'profile-invite']) {
        expect(screen.getByTestId(id)).toHaveStyle({ flexGrow: 1 });
        expect(screen.getByTestId(id)).not.toHaveStyle({ flex: 1 });
      }
    },
  );
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
    expect(sequence).toHaveBeenCalledTimes(1);
  });

  it('nome, @, cidade e nível num elemento só; o avatar e o anel ficam fora do leitor', () => {
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
    // O anel não é outro foco, e as iniciais ficam no avatar, fora do leitor.
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('CR', hidden)).toBeTruthy();
    expect(screen.queryByText('CR')).toBeNull();
    // Nada tocável: a edição vai pelo botão "Editar perfil".
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a bio vem embaixo do avatar, como texto lido à parte; sem bio, nada', () => {
    const bio = 'Feira de Santana.\nFã do Netto desde o primeiro show.';
    const { rerender } = render(
      <ProfileHero {...hero} bio={bio} level={PURAINHA} levelFraction={0.685} />,
    );
    expect(screen.getByText(bio)).toBeTruthy();

    rerender(<ProfileHero {...hero} bio={null} level={PURAINHA} levelFraction={0.685} />);
    expect(screen.queryByText(bio, hidden)).toBeNull();
  });

  it.each([1, 1.15, Math.fround(1.3), 2])(
    'a %sx, o nome, o @ e os números ficam ao lado do avatar, e a bio embaixo dele',
    (scale) => {
      setFontScale(scale);
      render(
        <ProfileHero
          {...hero}
          testID="hero"
          bio="Fã do Netto."
          level={PURAINHA}
          levelFraction={0.685}
          numbers={<Text>números</Text>}
        />,
      );
      const top = screen.getByTestId('hero-top');
      expect(top).toHaveStyle({ flexDirection: 'row' });
      const beside = within(top);
      expect(beside.getByTestId('hero')).toBeTruthy();
      expect(beside.getByText('números')).toBeTruthy();
      expect(beside.queryByText('Fã do Netto.')).toBeNull();
      expect(screen.getByText('Fã do Netto.')).toBeTruthy();
    },
  );

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

  it('carregando, é um elemento ocupado com "Carregando seu perfil", ainda sem a bio', () => {
    render(
      <ProfileHero
        testID="hero"
        uid="uid"
        name={null}
        photoURL={null}
        username={null}
        city={null}
        bio="não aparece enquanto carrega"
        loading
        level={null}
        levelFraction={0}
      />,
    );
    const hero = screen.getByTestId('hero');
    expect(hero).toHaveProp('accessibilityLabel', 'Carregando seu perfil');
    expect(hero).toBeBusy();
    expect(screen.queryByText('não aparece enquanto carrega', hidden)).toBeNull();
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

describe('AchievementTile', () => {
  const unlocked: Achievement = {
    id: 'top-20',
    title: 'Top 20',
    icon: 'trophy',
    tone: 'points',
    unlockedAt: '2026-09-24T20:00:00.000Z',
  };

  /** O Svg do ícone do Phosphor, pelo testID que ele mesmo põe (nome e peso). */
  const phosphor = (name: string) =>
    screen.getByTestId(`phosphor-react-native-${name}-duotone`, hidden);

  it('conquistada: a medalha do Phosphor em duotone na cor do assunto, sem quadro, e o nome em branco', () => {
    render(<AchievementTile testID="tile" achievement={unlocked} />);
    // O estilo chega ao host como lista: achatado, a conferência vale.
    const flat = StyleSheet.flatten(screen.getByLabelText('Top 20, conquistada').props.style);
    expect(flat).not.toHaveProperty('backgroundColor');
    expect(flat).not.toHaveProperty('borderWidth');
    expect(flat).not.toHaveProperty('borderStyle');
    expect(phosphor('trophy')).toHaveProp('color', colors.points);
    expect(screen.getByText('Top 20', hidden)).toHaveStyle({ color: colors.text });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    ['share', 'share-fat'],
    ['ticket', 'ticket'],
    ['star', 'star'],
    ['users', 'users-three'],
    ['heart', 'heart'],
    ['comment', 'chat-circle-dots'],
    ['calendar', 'calendar-check'],
    ['flame', 'fire'],
    ['chave-que-o-app-nao-conhece', 'medal'],
  ])('a chave "%s" do painel vira o ícone %s do Phosphor', (icon, name) => {
    render(<AchievementTile achievement={{ ...unlocked, icon, tone: 'action' }} />);
    expect(phosphor(name)).toHaveProp('color', colors.accent);
  });

  it('bloqueada: o cadeado e o nome em textMuted, nunca abaixo de .5', () => {
    render(
      <AchievementTile
        testID="tile"
        achievement={{ ...unlocked, id: 'backstage', title: 'Backstage', unlockedAt: null }}
      />,
    );
    expect(screen.getByLabelText('Backstage, bloqueada')).toBeTruthy();
    expect(phosphor('lock-simple')).toHaveProp('color', colors.textMuted);
    expect(screen.queryByTestId('phosphor-react-native-trophy-duotone', hidden)).toBeNull();
    expect(screen.getByText('Backstage', hidden)).toHaveStyle({ color: colors.textMuted });
  });

  const FOUR: Achievement[] = ['a', 'b', 'c', 'd'].map((id) => ({ ...unlocked, id, title: id }));

  it.each([1, 1.15])('a %sx, as quatro numa linha só, da mesma largura', (scale) => {
    setFontScale(scale);
    render(<AchievementsRow testID="row" achievements={FOUR} />);
    expect(StyleSheet.flatten(screen.getByTestId('row').props.style)).not.toHaveProperty(
      'flexWrap',
    );
    const tile = StyleSheet.flatten(screen.getByTestId('profile-achievement-a').props.style);
    expect(tile).toEqual(expect.objectContaining({ flex: 1 }));
    expect(tile).not.toHaveProperty('flexBasis');
  });

  it.each([Math.fround(1.3), 2])(
    'a %sx, duas por linha, para o nome não quebrar no meio da palavra',
    (scale) => {
      setFontScale(scale);
      render(<AchievementsRow testID="row" achievements={FOUR} />);
      expect(screen.getByTestId('row')).toHaveStyle({ flexDirection: 'row', flexWrap: 'wrap' });
      for (const id of ['a', 'b', 'c', 'd']) {
        expect(screen.getByTestId(`profile-achievement-${id}`)).toHaveStyle({ flexBasis: '40%' });
      }
    },
  );
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
