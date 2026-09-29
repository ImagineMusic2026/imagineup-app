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

/** Larguras dos rótulos; as abas somam a margem de dentro e ficam lado a lado. */
function layoutFor(labelWidths: Record<ArtistTab, number>) {
  let x = ROW_INSET;
  const boxes = {} as Record<ArtistTab, { x: number; width: number; label: number }>;
  for (const tab of tabs) {
    const width = labelWidths[tab.value] + 2 * INSET;
    boxes[tab.value] = { x, width, label: labelWidths[tab.value] };
    x += width;
  }
  return { boxes, contentEnd: x + ROW_INSET };
}

// Rótulos da 1d a 100% (Mural, Missões, Agenda, Ranking) e a 200%.
const regular = layoutFor({ mural: 37, missoes: 50, agenda: 45, ranking: 48 });
const doubled = layoutFor({ mural: 78, missoes: 112, agenda: 106, ranking: 114 });
const VIEWPORT = 390;

function layoutEvent(x: number, width: number) {
  return { nativeEvent: { layout: { x, y: 0, width, height: layout.minTouchTarget } } };
}

/** Mede como o nativo: a janela da rolagem, cada aba e o rótulo dentro dela. */
function measureTabs(boxes = regular.boxes) {
  fireEvent(screen.UNSAFE_getByType(ScrollView), 'layout', layoutEvent(0, VIEWPORT));
  for (const tab of tabs) {
    const box = boxes[tab.value];
    fireEvent(screen.getByTestId(`abas-${tab.value}`), 'layout', layoutEvent(box.x, box.width));
    fireEvent(
      screen.getByTestId(`abas-${tab.value}-label`),
      'layout',
      layoutEvent(INSET, box.label),
    );
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
    // "Mural" tem 37 de rótulo e 57 de aba.
    expect(regular.boxes.mural.width).toBeGreaterThanOrEqual(layout.minTouchTarget);
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
    const missoes = regular.boxes.missoes;
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
    const agenda = regular.boxes.agenda;
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

    measureTabs(doubled.boxes);
    expect(doubled.contentEnd).toBeGreaterThan(VIEWPORT);
    expect(scrollTo).not.toHaveBeenCalled();

    rerender(<UnderlineTabs testID="abas" tabs={tabs} value="ranking" onChange={jest.fn()} />);
    expect(scrollTo).toHaveBeenLastCalledWith({
      x: doubled.contentEnd - VIEWPORT,
      animated: true,
    });
  });

  it('com reduzir movimento, rola até a aba sem animar', () => {
    mockReducedMotion = true;
    const { rerender } = render(
      <UnderlineTabs testID="abas" tabs={tabs} value="mural" onChange={jest.fn()} />,
    );
    measureTabs(doubled.boxes);
    rerender(<UnderlineTabs testID="abas" tabs={tabs} value="ranking" onChange={jest.fn()} />);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ animated: false }));
  });

  it('abre já mostrando a aba escolhida, sem animar', () => {
    render(<UnderlineTabs testID="abas" tabs={tabs} value="ranking" onChange={jest.fn()} />);
    measureTabs(doubled.boxes);
    expect(scrollTo).toHaveBeenLastCalledWith({
      x: doubled.contentEnd - VIEWPORT,
      animated: false,
    });
  });
});
