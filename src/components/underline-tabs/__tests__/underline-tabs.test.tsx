import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, ScrollView, StyleSheet } from 'react-native';

import { haptics } from '@/services/haptics';
import { layout, spacing } from '@/theme';

import { UnderlineTabs, type UnderlineTab } from '..';

jest.mock('@/services/haptics', () => ({ haptics: { trigger: jest.fn() } }));

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

type ArtistTab = 'mural' | 'missoes' | 'agenda' | 'ranking';

const tabs: UnderlineTab<ArtistTab>[] = [
  { value: 'mural', label: 'Mural' },
  { value: 'missoes', label: 'Missões' },
  { value: 'agenda', label: 'Agenda' },
  { value: 'ranking', label: 'Ranking' },
];

// O mock do ScrollView do React Native põe os métodos no protótipo.
const scrollTo = (ScrollView.prototype as unknown as { scrollTo: jest.Mock }).scrollTo;

// Metade do vão de 20 do protótipo vai para dentro de cada aba.
const INSET = spacing.sectionTopTight / 2;
const ROW_INSET = spacing.gutter - INSET;

type Widths = Record<ArtistTab, { active: number; idle: number }>;

/**
 * Onde as abas ficam com a escolha: a escolhida mede o rótulo em Sora, as
 * outras em Manrope, cada uma com a margem de dentro, lado a lado.
 */
function layoutFor(widths: Widths, value: ArtistTab) {
  let x = ROW_INSET;
  const boxes = {} as Record<ArtistTab, { x: number; width: number; label: number }>;
  for (const tab of tabs) {
    const label = tab.value === value ? widths[tab.value].active : widths[tab.value].idle;
    const width = label + 2 * INSET;
    boxes[tab.value] = { x, width, label };
    x += width;
  }
  return { boxes, contentEnd: x + ROW_INSET };
}

// Rótulos da 1d a 100% (Sora na escolhida, Manrope nas outras) e a 200%.
const regular: Widths = {
  mural: { active: 38, idle: 35 },
  missoes: { active: 51, idle: 48 },
  agenda: { active: 47, idle: 45 },
  ranking: { active: 49, idle: 47 },
};
const doubled: Widths = {
  mural: { active: 78, idle: 72 },
  missoes: { active: 112, idle: 104 },
  agenda: { active: 106, idle: 98 },
  ranking: { active: 114, idle: 106 },
};
const VIEWPORT = 390;

function layoutEvent(width: number) {
  return { nativeEvent: { layout: { x: 0, y: 0, width, height: layout.minTouchTarget } } };
}

/** Mede como o nativo: a janela da rolagem e as réguas de cada rótulo, nos dois estados. */
function measureTabs(widths: Widths = regular) {
  fireEvent(screen.UNSAFE_getByType(ScrollView), 'layout', layoutEvent(VIEWPORT));
  for (const tab of tabs) {
    for (const part of ['active', 'idle'] as const) {
      fireEvent(
        screen.getByTestId(`abas-${tab.value}-ruler-${part}`, { includeHiddenElements: true }),
        'layout',
        layoutEvent(widths[tab.value][part]),
      );
    }
  }
}

beforeEach(() => {
  mockReducedMotion = false;
  jest.mocked(haptics.trigger).mockClear();
  scrollTo.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('UnderlineTabs', () => {
  it('a fileira é uma tablist e cada aba diz se está escolhida (botão no iOS)', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    render(<UnderlineTabs testID="abas" tabs={tabs} value="mural" onChange={jest.fn()} />);

    expect(screen.getByTestId('abas')).toHaveProp('accessibilityRole', 'tablist');
    expect(screen.getByRole('button', { name: 'Mural', selected: true })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Agenda', selected: false })).toBeOnTheScreen();
  });

  it('no Android cada aba tem papel de aba', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    render(<UnderlineTabs tabs={tabs} value="mural" onChange={jest.fn()} />);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: 'Mural', selected: true })).toBeOnTheScreen();
  });

  it('cada aba tem alvo de 44 nos dois sentidos, e o vão entre elas também é toque', () => {
    render(<UnderlineTabs testID="abas" tabs={tabs} value="mural" onChange={jest.fn()} />);
    expect(screen.getByTestId('abas-mural')).toHaveStyle({
      minHeight: layout.minTouchTarget,
      minWidth: layout.minTouchTarget,
      paddingHorizontal: INSET,
    });
    // "Mural" tem 38 de rótulo e 58 de aba.
    expect(layoutFor(regular, 'mural').boxes.mural.width).toBeGreaterThanOrEqual(
      layout.minTouchTarget,
    );
  });

  it('cada rótulo fica com a largura do estado em que está, e a aba escolhida com a do rótulo em Sora', () => {
    const { rerender } = render(
      <UnderlineTabs testID="abas" tabs={tabs} value="mural" onChange={jest.fn()} />,
    );
    measureTabs();
    expect(screen.getByTestId('abas-mural-label')).toHaveStyle({ width: regular.mural.active });
    expect(screen.getByTestId('abas-agenda-label')).toHaveStyle({ width: regular.agenda.idle });

    // O mock do Reanimated vai direto ao fim da animação.
    rerender(<UnderlineTabs testID="abas" tabs={tabs} value="agenda" onChange={jest.fn()} />);
    expect(screen.getByTestId('abas-agenda-label')).toHaveStyle({ width: regular.agenda.active });
    expect(screen.getByTestId('abas-mural-label')).toHaveStyle({ width: regular.mural.idle });
  });

  it('tocar noutra aba avisa a escolha, com o toque de seleção', () => {
    const onChange = jest.fn();
    render(<UnderlineTabs tabs={tabs} value="mural" onChange={onChange} />);
    fireEvent.press(screen.getByRole('button', { name: 'Ranking' }));
    expect(onChange).toHaveBeenCalledWith('ranking');
    expect(haptics.trigger).toHaveBeenCalledWith('selection');
  });

  it('tocar na aba escolhida não avisa nem vibra', () => {
    const onChange = jest.fn();
    render(<UnderlineTabs tabs={tabs} value="mural" onChange={onChange} />);
    fireEvent.press(screen.getByRole('button', { name: 'Mural' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('o traço só aparece medido, já embaixo do rótulo da aba escolhida', () => {
    render(<UnderlineTabs testID="abas" tabs={tabs} value="missoes" onChange={jest.fn()} />);
    expect(screen.queryByTestId('abas-indicator')).toBeNull();

    measureTabs();
    const missoes = layoutFor(regular, 'missoes').boxes.missoes;
    expect(screen.getByTestId('abas-indicator')).toHaveStyle({
      width: missoes.label,
      transform: [{ translateX: missoes.x + INSET }],
    });
  });

  it('o primeiro rótulo continua na margem de 18 da tela', () => {
    render(<UnderlineTabs testID="abas" tabs={tabs} value="mural" onChange={jest.fn()} />);
    measureTabs();
    expect(screen.getByTestId('abas-indicator')).toHaveStyle({
      transform: [{ translateX: spacing.gutter }],
    });
  });

  it('o traço vai até a aba nova quando a escolha muda', () => {
    const { rerender } = render(
      <UnderlineTabs testID="abas" tabs={tabs} value="mural" onChange={jest.fn()} />,
    );
    measureTabs();
    rerender(<UnderlineTabs testID="abas" tabs={tabs} value="agenda" onChange={jest.fn()} />);
    // As abas antes dela encolhem (Mural volta ao Manrope) e o traço vai ao lugar final.
    const agenda = layoutFor(regular, 'agenda').boxes.agenda;
    expect(screen.getByTestId('abas-indicator')).toHaveStyle({
      width: agenda.label,
      transform: [{ translateX: agenda.x + INSET }],
    });
  });

  it('com a fonte a 200%, a fileira rola e a aba escolhida entra na tela', () => {
    const { rerender } = render(
      <UnderlineTabs testID="abas" tabs={tabs} value="mural" onChange={jest.fn()} />,
    );
    const row = screen.UNSAFE_getByType(ScrollView);
    expect(row.props.horizontal).toBe(true);
    expect(StyleSheet.flatten(row.props.contentContainerStyle).paddingHorizontal).toBe(ROW_INSET);

    measureTabs(doubled);
    expect(layoutFor(doubled, 'mural').contentEnd).toBeGreaterThan(VIEWPORT);
    expect(scrollTo).not.toHaveBeenCalled();

    rerender(<UnderlineTabs testID="abas" tabs={tabs} value="ranking" onChange={jest.fn()} />);
    expect(scrollTo).toHaveBeenLastCalledWith({
      x: layoutFor(doubled, 'ranking').contentEnd - VIEWPORT,
      animated: true,
    });
  });

  it('com reduzir movimento, rola até a aba sem animar', () => {
    mockReducedMotion = true;
    const { rerender } = render(
      <UnderlineTabs testID="abas" tabs={tabs} value="mural" onChange={jest.fn()} />,
    );
    measureTabs(doubled);
    rerender(<UnderlineTabs testID="abas" tabs={tabs} value="ranking" onChange={jest.fn()} />);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ animated: false }));
  });

  it('abre já mostrando a aba escolhida, sem animar', () => {
    render(<UnderlineTabs testID="abas" tabs={tabs} value="ranking" onChange={jest.fn()} />);
    measureTabs(doubled);
    expect(scrollTo).toHaveBeenLastCalledWith({
      x: layoutFor(doubled, 'ranking').contentEnd - VIEWPORT,
      animated: false,
    });
  });
});
