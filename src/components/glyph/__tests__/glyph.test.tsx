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

  it.each(['instagram', 'tiktok', 'linkedin', 'x'] as const)(
    'a marca %s é cheia, na cor de quem usa (nunca a da marca), e decorativa',
    (name) => {
      render(<Glyph name={name} size={18} color={colors.textMuted} />);
      expect(isHiddenFromAccessibility(screen.root)).toBe(true);
      expect(screen.root).toHaveProp('width', 18);
      const paths = screen.root.findAll((node) => node.type === Path);
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path.props.fill).toBe(colors.textMuted);
        expect(path.props.stroke).toBeUndefined();
        expect(path.props.d.length).toBeGreaterThan(20);
      }
    },
  );

  it('a taça tem o copo cheio e o pé em traço, na mesma cor', () => {
    render(<Glyph name="goblet" size={24} color={colors.points} />);
    const [cup, stem] = screen.root.findAll((node) => node.type === Path);
    expect(cup?.props.fill).toBe(colors.points);
    expect(cup?.props.stroke).toBeUndefined();
    expect(stem?.props.fill).toBe('none');
    expect(stem?.props.stroke).toBe(colors.points);
  });
});
