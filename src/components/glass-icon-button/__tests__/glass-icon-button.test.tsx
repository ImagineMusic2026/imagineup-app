import { fireEvent, render, screen } from '@testing-library/react-native';
import { ChevronLeft, Ellipsis } from 'lucide-react-native';

import { Glass } from '@/components/glass';
import { Glyph } from '@/components/glyph';
import { layout } from '@/theme';

import { GlassIconButton } from '..';

describe('GlassIconButton', () => {
  it('o círculo de vidro de 38 fica no centro de um alvo de 44', () => {
    render(<GlassIconButton icon={ChevronLeft} accessibilityLabel="Voltar" onPress={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Voltar' })).toHaveStyle({
      width: layout.minTouchTarget,
      height: layout.minTouchTarget,
    });
    const glass = screen.UNSAFE_getByType(Glass);
    expect(glass.props.radius).toBe(layout.coverButtonSize / 2);
    expect(glass.props.style).toMatchObject({
      width: layout.coverButtonSize,
      height: layout.coverButtonSize,
    });
  });

  it('vidro escuro por padrão, com o tom de quem chama', () => {
    const { rerender } = render(
      <GlassIconButton icon={Ellipsis} accessibilityLabel="Mais opções" onPress={jest.fn()} />,
    );
    expect(screen.UNSAFE_getByType(Glass).props.tone).toBe('dark');

    rerender(
      <GlassIconButton
        icon={Ellipsis}
        tone="darkStrong"
        accessibilityLabel="Mais opções"
        onPress={jest.fn()}
      />,
    );
    expect(screen.UNSAFE_getByType(Glass).props.tone).toBe('darkStrong');
  });

  it('é um elemento só: o rótulo é de quem chama e o ícone fica escondido', () => {
    const onPress = jest.fn();
    render(<GlassIconButton icon={ChevronLeft} accessibilityLabel="Voltar" onPress={onPress} />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.UNSAFE_getByType(ChevronLeft).props.accessibilityElementsHidden).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('aceita o desenho cheio no lugar do ícone', () => {
    render(<GlassIconButton glyph="share" accessibilityLabel="Compartilhar" onPress={jest.fn()} />);

    expect(screen.UNSAFE_getByType(Glyph).props.name).toBe('share');
    expect(screen.getByRole('button', { name: 'Compartilhar' })).toBeTruthy();
  });

  it('o estado de quem chama chega ao leitor, como o menu aberto', () => {
    render(
      <GlassIconButton
        icon={Ellipsis}
        accessibilityLabel="Mais opções"
        accessibilityState={{ expanded: true }}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Mais opções' })).toBeExpanded();
  });

  it('desativado: não dispara', () => {
    const onPress = jest.fn();
    render(
      <GlassIconButton
        glyph="share"
        accessibilityLabel="Compartilhar"
        disabled
        onPress={onPress}
      />,
    );

    const button = screen.getByRole('button', { name: 'Compartilhar' });
    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});
