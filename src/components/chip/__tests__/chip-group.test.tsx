import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, ScrollView, StyleSheet } from 'react-native';

import { haptics } from '@/services/haptics';
import { spacing } from '@/theme';

import { ChipGroup, type ChipItem } from '..';

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

type Scope = 'geral' | 'netto' | 'nenho';

const scopes: ChipItem<Scope>[] = [
  { value: 'geral', label: 'Geral' },
  { value: 'netto', label: 'Netto Brito' },
  { value: 'nenho', label: 'Nenho' },
];

const months: ChipItem<string>[] = ['out', 'nov', 'dez', 'jan', 'fev', 'mar'].map((value) => ({
  value,
  label: value,
}));

// O mock do ScrollView do React Native põe os métodos no protótipo.
const scrollTo = (ScrollView.prototype as unknown as { scrollTo: jest.Mock }).scrollTo;

const CHIP_WIDTH = 63;
const CHIP_STRIDE = CHIP_WIDTH + spacing.chipGap;
const VIEWPORT = 200;

function layoutEvent(x: number, width: number) {
  return { nativeEvent: { layout: { x, y: 0, width, height: 44 } } };
}

/** Mede a fileira e os chips como o nativo faria: primeiro a janela, depois os chips. */
function measure(testID: string, items: ChipItem<string>[]) {
  fireEvent(screen.UNSAFE_getByType(ScrollView), 'layout', layoutEvent(0, VIEWPORT));
  items.forEach((item, index) => {
    fireEvent(
      screen.getByTestId(`${testID}-${item.value}`),
      'layout',
      layoutEvent(spacing.gutter + index * CHIP_STRIDE, CHIP_WIDTH),
    );
  });
}

beforeEach(() => {
  mockReducedMotion = false;
  scrollTo.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ChipGroup', () => {
  it('na seleção única, o escolhido fica marcado e tocar outro avisa o novo valor', () => {
    const onChange = jest.fn();
    render(<ChipGroup items={scopes} value="geral" onChange={onChange} />);

    expect(screen.getByRole('button', { name: 'Geral', selected: true })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Nenho', selected: false })).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Netto Brito' }));
    expect(onChange).toHaveBeenCalledWith('netto');
  });

  it('tocar no que já está escolhido não avisa nada', () => {
    const onChange = jest.fn();
    render(<ChipGroup items={scopes} value="geral" onChange={onChange} />);
    fireEvent.press(screen.getByRole('button', { name: 'Geral' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('com onReselect, tocar no escolhido avisa por ele, e o toque vibra como os outros', () => {
    const onChange = jest.fn();
    const onReselect = jest.fn();
    const trigger = jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
    render(<ChipGroup items={scopes} value="geral" onChange={onChange} onReselect={onReselect} />);

    fireEvent.press(screen.getByRole('button', { name: 'Geral' }));
    expect(onReselect).toHaveBeenCalledWith('geral');
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveBeenCalledWith('selection');

    fireEvent.press(screen.getByRole('button', { name: 'Nenho' }));
    expect(onChange).toHaveBeenCalledWith('nenho');
    expect(onReselect).toHaveBeenCalledTimes(1);
  });

  it('sem onReselect, tocar no escolhido não vibra', () => {
    const trigger = jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
    render(<ChipGroup items={scopes} value="geral" onChange={jest.fn()} />);
    fireEvent.press(screen.getByRole('button', { name: 'Geral' }));
    expect(trigger).not.toHaveBeenCalled();
  });

  it('na seleção múltipla, liga e desliga devolvendo na ordem dos itens', () => {
    const onChange = jest.fn();
    render(<ChipGroup multiple items={scopes} value={['nenho']} onChange={onChange} />);

    fireEvent.press(screen.getByRole('button', { name: 'Geral' }));
    expect(onChange).toHaveBeenLastCalledWith(['geral', 'nenho']);

    fireEvent.press(screen.getByRole('button', { name: 'Nenho', selected: true }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('no Android, a seleção única é uma tablist de abas', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    render(<ChipGroup testID="escopos" items={scopes} value="geral" onChange={jest.fn()} />);
    // A tablist não é elemento acessível (agrupar os chips num foco só os esconderia).
    expect(screen.getByTestId('escopos')).toHaveProp('accessibilityRole', 'tablist');
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('no Android, a seleção múltipla é uma lista de caixas de marcar, sem tablist', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    render(
      <ChipGroup testID="escopos" multiple items={scopes} value={['netto']} onChange={jest.fn()} />,
    );
    expect(screen.getByTestId('escopos')).not.toHaveProp('accessibilityRole');
    expect(screen.getByRole('checkbox', { name: 'Netto Brito', checked: true })).toBeOnTheScreen();
  });

  it('no iOS a fileira não vira tablist: cada chip é botão com "selecionado"', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    render(<ChipGroup testID="escopos" items={scopes} value="geral" onChange={jest.fn()} />);
    expect(screen.getByTestId('escopos')).not.toHaveProp('accessibilityRole');
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('a rolagem vai de ponta a ponta com a margem do tema dentro dela', () => {
    const { rerender } = render(<ChipGroup items={scopes} value="geral" onChange={jest.fn()} />);
    const padding = () =>
      StyleSheet.flatten(screen.UNSAFE_getByType(ScrollView).props.contentContainerStyle)
        .paddingHorizontal;
    expect(padding()).toBe(spacing.gutter);

    rerender(<ChipGroup items={scopes} value="geral" gutter="none" onChange={jest.fn()} />);
    expect(padding()).toBe(0);
  });

  it('quando a escolha muda para um chip cortado, rola até ele com a margem sobrando', () => {
    const { rerender } = render(
      <ChipGroup testID="meses" items={months} value="out" onChange={jest.fn()} />,
    );
    measure('meses', months);
    expect(scrollTo).not.toHaveBeenCalled();

    rerender(<ChipGroup testID="meses" items={months} value="fev" onChange={jest.fn()} />);
    const end = spacing.gutter + 4 * CHIP_STRIDE + CHIP_WIDTH + spacing.gutter;
    expect(scrollTo).toHaveBeenLastCalledWith({ x: end - VIEWPORT, animated: true });

    fireEvent.scroll(screen.UNSAFE_getByType(ScrollView), {
      nativeEvent: { contentOffset: { x: end - VIEWPORT, y: 0 } },
    });
    rerender(<ChipGroup testID="meses" items={months} value="out" onChange={jest.fn()} />);
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 0, animated: true });
  });

  it('com reduzir movimento, rola sem animar', () => {
    mockReducedMotion = true;
    const { rerender } = render(
      <ChipGroup testID="meses" items={months} value="out" onChange={jest.fn()} />,
    );
    measure('meses', months);
    rerender(<ChipGroup testID="meses" items={months} value="mar" onChange={jest.fn()} />);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ animated: false }));
  });

  it('abre já mostrando o escolhido, sem animar', () => {
    render(<ChipGroup testID="meses" items={months} value="mar" onChange={jest.fn()} />);
    measure('meses', months);
    const end = spacing.gutter + 5 * CHIP_STRIDE + CHIP_WIDTH + spacing.gutter;
    expect(scrollTo).toHaveBeenLastCalledWith({ x: end - VIEWPORT, animated: false });
  });

  it('o chip escolhido que entra no fim da fileira aparece quando o conteúdo cresce', () => {
    // A central que o fã não segue, aberta por /ranking?artista=: o chip dela
    // nasce junto com a escolha, e a rolagem pedida antes de o conteúdo crescer
    // parava no fim antigo.
    const first = months.slice(0, 5);
    const { rerender } = render(
      <ChipGroup testID="meses" items={first} value="mar" onChange={jest.fn()} />,
    );
    measure('meses', first);
    rerender(<ChipGroup testID="meses" items={months} value="mar" onChange={jest.fn()} />);
    measure('meses', months);
    // O nativo parou antes: a rolagem só chegou ao fim antigo.
    fireEvent.scroll(screen.UNSAFE_getByType(ScrollView), {
      nativeEvent: { contentOffset: { x: 100, y: 0 } },
    });
    scrollTo.mockClear();

    fireEvent(screen.UNSAFE_getByType(ScrollView), 'contentSizeChange', 600, 44);

    const end = spacing.gutter + 5 * CHIP_STRIDE + CHIP_WIDTH + spacing.gutter;
    expect(scrollTo).toHaveBeenLastCalledWith({ x: end - VIEWPORT, animated: false });
  });
});
