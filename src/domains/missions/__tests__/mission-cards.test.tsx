import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Dimensions, StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { IconTile } from '@/components/icon-tile';
import { PressableScale } from '@/components/pressable-scale';
import { ProgressRing } from '@/components/progress-ring';
import { haptics } from '@/services/haptics';
import { colors, typography } from '@/theme';
import { withAlpha } from '@/utils/color';

import { FeaturedMissionCard } from '../components/featured-mission-card';
import { MissionRow } from '../components/mission-row';
import { SeasonGoalCard } from '../components/season-goal-card';
import { buildMissionsFixture } from '../fixtures';
import type { Mission } from '../types';

const NOW = new Date(2026, 8, 29, 20, 0);
const { season, missions } = buildMissionsFixture(NOW);
const hidden = { includeHiddenElements: true } as const;

function byId(id: string): Mission {
  const mission = missions.find((item) => item.id === id);
  if (!mission) throw new Error(`missão ${id} não existe nas fixtures`);
  return mission;
}

const CLIP = byId('m-clipe-netto');
const LIKE = byId('m-curtir-nenho');
const COMMENT = byId('m-comentar-central');
const FLASH = byId('m-relampago-show');
const RSVP = byId('m-presenca-show');

const completed = (mission: Mission): Mission => ({
  ...mission,
  status: 'completed',
  progress: { ...mission.progress, current: mission.progress.target },
  completedAt: NOW.toISOString(),
});

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
let announce: jest.SpyInstance;

beforeEach(() => {
  vibrate = jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
  announce.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('linha de missão', () => {
  it('aberta: um botão só, com título, andamento e pontos, e a dica de para onde leva', () => {
    const onPress = jest.fn();
    render(<MissionRow mission={LIKE} onPress={onPress} />);

    const row = screen.getByRole('button', {
      name: 'Curta 5 posts do Nenho. Você tem 2 de 5. Vale 10 pontos.',
    });
    expect(row).toHaveProp('accessibilityHint', 'Abre a central do artista');
    // O "+10" aparece, mas quem fala é a linha.
    expect(screen.queryByText('+10')).toBeNull();
    expect(screen.getByText('+10', hidden)).toBeTruthy();
    expect(nestedPressables()).toEqual([]);

    fireEvent.press(row);
    expect(onPress).toHaveBeenCalledWith(LIKE);
    expect(vibrate).toHaveBeenCalledWith('tap');
  });

  it('presença em show mostra o show sugerido e a data', () => {
    render(<MissionRow mission={RSVP} onPress={jest.fn()} />);
    expect(screen.getByText('São João de Irará · 21 out', hidden)).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Confirme presença em um show. São João de Irará, 21 de outubro. Vale 15 pontos.',
      }),
    ).toHaveProp('accessibilityHint', 'Abre a agenda');
  });

  it('concluída: sem toque, lida com a hora e o que rendeu', () => {
    render(<MissionRow mission={COMMENT} onPress={jest.fn()} />);

    expect(screen.UNSAFE_queryAllByType(PressableScale)).toEqual([]);
    expect(screen.queryByRole('button')).toBeNull();
    expect(
      screen.getByLabelText('Comente em 3 posts da central. Concluída às 14:02. Rendeu 20 pontos.'),
    ).toBeTruthy();
  });

  it('bloqueada: tocável, vibra "bloqueada", não se diz desativada e deixa o anúncio para quem chama', () => {
    const onPress = jest.fn();
    render(<MissionRow mission={FLASH} onPress={onPress} />);

    const row = screen.getByRole('button', {
      name: 'Missão relâmpago do show. Bloqueada. Abre quando o Netto subir no palco. Vale 50 pontos.',
    });
    expect(row).toHaveProp('accessibilityState', { disabled: false });
    fireEvent.press(row);
    expect(vibrate).toHaveBeenCalledWith('locked');
    expect(onPress).toHaveBeenCalledWith(FLASH);
  });

  it('bloqueada não usa opacidade: a meta fica no branco a .5, legível', () => {
    render(<MissionRow mission={FLASH} onPress={jest.fn()} />);
    const meta = screen.getByText('Abre quando o Netto subir no palco', hidden);
    expect(meta).toHaveStyle({ color: 'rgba(255, 255, 255, 0.5)' });
    expect(screen.getByRole('button')).not.toHaveStyle({ opacity: 0.5 });
  });

  it('bloqueada apaga as superfícies, como o card a .5 do protótipo: fundo e quadro do cadeado', () => {
    render(<MissionRow mission={FLASH} onPress={jest.fn()} />);
    expect(screen.getByRole('button')).toHaveStyle({
      backgroundColor: withAlpha(colors.surface, 0.5),
    });
    const tile = screen.UNSAFE_getByType(IconTile);
    expect(StyleSheet.flatten(tile.props.style)).toEqual({
      backgroundColor: withAlpha(colors.text, 0.03),
    });
  });

  it('aberta mantém o fundo do card', () => {
    render(<MissionRow mission={LIKE} onPress={jest.fn()} />);
    expect(screen.getByRole('button')).toHaveStyle({ backgroundColor: colors.surface });
  });
});

describe('conclusão diante do fã', () => {
  it('o "+N" sobe da linha; o toque e o anúncio ficam com a tela', () => {
    const { rerender } = render(<MissionRow mission={RSVP} onPress={jest.fn()} />);
    rerender(<MissionRow mission={completed(RSVP)} onPress={jest.fn()} celebration={1} />);
    rerender(<MissionRow mission={completed(RSVP)} onPress={jest.fn()} celebration={1} />);

    expect(screen.getByText('+15', hidden)).toBeTruthy();
    // A célula pode nem estar montada quando a missão conclui: quem avisa é a 1g.
    expect(vibrate).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it('abrir a tela com a missão já concluída não festeja', () => {
    render(<MissionRow mission={completed(RSVP)} onPress={jest.fn()} celebration={1} />);
    expect(screen.queryByText('+15', hidden)).toBeNull();
    expect(vibrate).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });
});

describe('card lima em destaque', () => {
  it('é um alvo só, sem botão dentro, com a régua do link no rótulo', () => {
    const onPress = jest.fn();
    render(<FeaturedMissionCard mission={CLIP} onPress={onPress} />);

    const card = screen.getByRole('button', {
      name: 'Leve 5 pessoas para o clipe novo do Netto. 3 de 5. Vale 20 pontos, 2 por visita e 10 por cadastro.',
    });
    // O mesmo destino do "Gerar meu link" da home: o link com o código do fã.
    expect(card).toHaveProp('accessibilityHint', 'Abre seu link de convite');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(nestedPressables()).toEqual([]);
    expect(screen.getByText('+2 por visita · +10 por cadastro', hidden)).toBeTruthy();
    expect(screen.getByText('3/5', hidden)).toBeTruthy();

    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledWith(CLIP);
  });

  it('concluído: barra cheia, check no lugar do "+20" e sem toque', () => {
    render(<FeaturedMissionCard mission={completed(CLIP)} onPress={jest.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(
      screen.getByLabelText(/^Leve 5 pessoas para o clipe novo do Netto\. Concluída às/),
    ).toBeTruthy();
    expect(screen.getByText('5/5', hidden)).toBeTruthy();
    expect(screen.queryByText('+20', hidden)).toBeNull();
  });

  it('concluído diante do fã: o "+20" sobe do card, em silêncio (a tela toca e anuncia)', () => {
    const { rerender } = render(<FeaturedMissionCard mission={CLIP} onPress={jest.fn()} />);
    rerender(<FeaturedMissionCard mission={completed(CLIP)} onPress={jest.fn()} celebration={3} />);
    expect(screen.getByText('+20', hidden)).toBeTruthy();
    expect(vibrate).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it('bloqueado: o cadeado vem no quadro escuro, lima, e não no vidro que some no lima', () => {
    const locked: Mission = { ...CLIP, status: 'locked', unlockHint: 'Abre às 20 h' };
    const onPress = jest.fn();
    render(<FeaturedMissionCard mission={locked} onPress={onPress} />);

    expect(screen.UNSAFE_getByType(IconTile).props.tone).toBe('ink');
    const card = screen.getByRole('button', {
      name: 'Leve 5 pessoas para o clipe novo do Netto. Bloqueada. Abre às 20 h. Vale 20 pontos.',
    });
    fireEvent.press(card);
    expect(vibrate).toHaveBeenCalledWith('locked');
    expect(onPress).toHaveBeenCalledWith(locked);
  });

  it('números sem tabular: o "1" tabular da Sora tem pé e abre um vão', () => {
    const oneOfFive: Mission = { ...CLIP, rewardPoints: 10, progress: { current: 1, target: 5 } };
    render(<FeaturedMissionCard mission={oneOfFive} onPress={jest.fn()} />);
    for (const text of ['+10', '1/5']) {
      expect(screen.getByText(text, hidden)).not.toHaveStyle({ fontVariant: ['tabular-nums'] });
    }
  });
});

describe('meta da temporada', () => {
  if (!season) throw new Error('as fixtures têm temporada');

  it('um foco só, lido como progresso: título, "12 de 20" e a descrição', () => {
    render(<SeasonGoalCard season={season} />);
    const card = screen.getByRole('progressbar', {
      name: 'Semana do arrocha. 12 de 20 concluídas. Complete 20 missões e garanta um lote de ingressos do São João.',
    });
    expect(card).toHaveProp('accessibilityValue', { min: 0, max: 20, now: 12 });
  });

  it('o número fica branco com o total pequeno; cumprida, fica lima', () => {
    const { rerender } = render(<SeasonGoalCard season={season} />);
    // Manrope 700 9 sem o espaçamento de letras do mês ("JUN"), e o "12" proporcional.
    expect(screen.getByText('/20', hidden)).toHaveStyle({
      ...typography.counterSuffix,
      color: 'rgba(255, 255, 255, 0.5)',
    });
    expect(screen.getByText('/20', hidden)).not.toHaveStyle({ letterSpacing: 0.8 });
    expect(screen.getByText(/^12/, hidden)).not.toHaveStyle({ fontVariant: ['tabular-nums'] });

    rerender(<SeasonGoalCard season={{ ...season, completedCount: 20 }} />);
    expect(screen.getByText('/20', hidden)).toHaveStyle({ color: '#D6FF3F' });
    expect(screen.getByRole('progressbar')).toHaveProp('accessibilityValue', {
      min: 0,
      max: 20,
      now: 20,
    });
  });

  describe('com a fonte do sistema', () => {
    const window = Dimensions.get('window');
    const setFontScale = (fontScale: number) =>
      Dimensions.set({ window: { ...window, fontScale } });
    afterEach(() => act(() => setFontScale(window.fontScale)));

    it.each([
      [1, 62, 7],
      [1.5, 93, 10.5],
      [2, 124, 14],
    ])(
      'a %sx, o anel mede %s com traço %s, e o número cresce sem limite próprio',
      (scale, size, stroke) => {
        setFontScale(scale);
        render(<SeasonGoalCard season={season} />);
        const ring = screen.UNSAFE_getByType(ProgressRing);
        expect(ring.props).toEqual(expect.objectContaining({ size, strokeWidth: stroke }));
        expect(screen.getByText(/^12/, hidden)).toHaveProp('maxFontSizeMultiplier', 2);
        expect(screen.getByText('/20', hidden)).toHaveProp('maxFontSizeMultiplier', 2);
      },
    );
  });
});
