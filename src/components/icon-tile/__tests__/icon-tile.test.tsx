import { render, screen } from '@testing-library/react-native';
import { Lock, Ticket, Video } from 'lucide-react-native';

import { colors, layout, tints } from '@/theme';
import { withAlpha } from '@/utils/color';

import { IconTile } from '..';

describe('IconTile', () => {
  it('é decorativo: fica fora do leitor de tela', () => {
    render(<IconTile icon={Ticket} testID="tile" />);

    expect(screen.queryByTestId('tile')).toBeNull();
    expect(screen.getByTestId('tile', { includeHiddenElements: true })).toBeTruthy();
  });

  it('md: quadrado de 38 com a cor do assunto a .14 e ícone de 19 na cor cheia', () => {
    render(<IconTile icon={Ticket} tone="action" testID="tile" />);

    expect(screen.getByTestId('tile', { includeHiddenElements: true })).toHaveStyle({
      width: layout.iconTile,
      height: layout.iconTile,
      backgroundColor: withAlpha(colors.accent, tints.soft.fill),
    });
    const icon = screen.UNSAFE_getByType(Ticket);
    expect(icon.props.color).toBe(colors.accent);
    expect(icon.props.size).toBe(19);
  });

  it('wide: largura toda, 74 de altura, tinta mais leve e ícone de 30', () => {
    render(<IconTile icon={Video} tone="events" size="wide" testID="tile" />);

    expect(screen.getByTestId('tile', { includeHiddenElements: true })).toHaveStyle({
      alignSelf: 'stretch',
      height: layout.rewardTileHeight,
      backgroundColor: withAlpha(colors.events, tints.faint.fill),
    });
    expect(screen.UNSAFE_getByType(Video).props.size).toBe(30);
  });

  it('glass: o bloqueado fica em vidro com o ícone apagado', () => {
    render(<IconTile icon={Lock} tone="glass" strokeWidth={1.7} testID="tile" />);

    expect(screen.getByTestId('tile', { includeHiddenElements: true })).toHaveStyle({
      backgroundColor: colors.glass,
    });
    const icon = screen.UNSAFE_getByType(Lock);
    expect(icon.props.color).toBe(colors.textMuted);
    expect(icon.props.strokeWidth).toBe(1.7);
  });

  it('renderIcon desenha o que o lucide não tem, com a cor e o tamanho do quadro', () => {
    const renderIcon = jest.fn(() => null);
    render(<IconTile renderIcon={renderIcon} tone="ink" testID="tile" />);

    expect(renderIcon).toHaveBeenCalledWith({ color: colors.points, size: 19 });
    expect(screen.getByTestId('tile', { includeHiddenElements: true })).toHaveStyle({
      backgroundColor: colors.background,
    });
  });
});
