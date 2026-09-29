import { isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import { Path } from 'react-native-svg';

import { colors, layout } from '@/theme';

import { Glyph } from '..';

function glyphPath() {
  const [path] = screen.root.findAll((node) => node.type === Path);
  return path;
}

describe('Glyph', () => {
  it('é decorativo, como o Icon: o pressável em volta descreve a ação', () => {
    render(<Glyph name="share" />);
    expect(isHiddenFromAccessibility(screen.root)).toBe(true);
  });

  it('sem tamanho e cor, usa os do Icon', () => {
    render(<Glyph name="share" />);
    expect(screen.root).toHaveProp('width', layout.tabBarIconSize);
    expect(glyphPath()?.props.fill).toBe(colors.text);
  });

  it('a seta de compartilhar é cheia, na cor pedida', () => {
    render(<Glyph name="share" size={15} color={colors.onPoints} />);
    expect(screen.root).toHaveProp('width', 15);
    expect(glyphPath()?.props.fill).toBe(colors.onPoints);
    expect(glyphPath()?.props.stroke).toBeUndefined();
  });
});
