import { isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { User } from 'lucide-react-native';
import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { avatarFallbacks, colors, gradients, layout } from '@/theme';
import { pickStable } from '@/utils/pick-stable';

import { Avatar, AvatarStack } from '..';

const hidden = { includeHiddenElements: true };

/** Estilo do N-ésimo View acima das iniciais: 1 é o círculo, 2 o anel ou a caixa de fora. */
function styleAbove(initials: string, levels = 1) {
  let node: ReactTestInstance | null = screen.getByText(initials, hidden);
  for (let level = 0; level < levels; level += 1) {
    node = node?.parent ?? null;
    while (node && (node.type as unknown) !== 'View') node = node.parent;
  }
  if (!node) throw new Error('View não encontrado');
  return StyleSheet.flatten(node.props.style);
}

const faceStyle = (initials: string) => styleAbove(initials, 1);

describe('Avatar', () => {
  it('sem foto, mostra as iniciais do nome', () => {
    render(<Avatar name="Camila Ribeiro" id="u-camila" />);
    expect(screen.getByText('CR', hidden)).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
  });

  it('a cor de fundo sai do id e não muda com o nome nem entre telas', () => {
    const expected = pickStable('netto-brito', avatarFallbacks);
    const { rerender } = render(<Avatar name="Netto Brito" id="netto-brito" />);
    expect(faceStyle('NB').backgroundColor).toBe(expected);

    rerender(<Avatar name="Netto B." id="netto-brito" size="lg" />);
    expect(faceStyle('NB').backgroundColor).toBe(expected);
  });

  it('ids diferentes caem em cores diferentes da paleta, sem depender do nome', () => {
    // Mesmas iniciais, ids que o hash separa.
    const { rerender } = render(<Avatar name="Nina Brito" id="netto-brito" />);
    const first = faceStyle('NB').backgroundColor;
    rerender(<Avatar name="Nina Brito" id="rock-salles" />);
    const second = faceStyle('NB').backgroundColor;

    expect(first).not.toBe(second);
    expect(avatarFallbacks).toContain(first);
    expect(avatarFallbacks).toContain(second);
  });

  it('com foto, a imagem cobre as iniciais; com URL nula ou vazia, a foto some', () => {
    const { rerender } = render(
      <Avatar name="Camila Ribeiro" id="u-camila" photoUrl="https://exemplo.com/camila.jpg" />,
    );
    expect(screen.UNSAFE_getByType(Image).props.source).toEqual({
      uri: 'https://exemplo.com/camila.jpg',
    });

    rerender(<Avatar name="Camila Ribeiro" id="u-camila" photoUrl={null} />);
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);

    rerender(<Avatar name="Camila Ribeiro" id="u-camila" photoUrl="" />);
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
    expect(screen.getByText('CR', hidden)).toBeTruthy();
  });

  it('sem nome, mostra o ícone de pessoa no lugar das iniciais', () => {
    render(<Avatar name={null} id="u-sem-nome" />);
    expect(screen.UNSAFE_getByType(User)).toBeTruthy();
  });

  it('fica oculto do leitor de tela', () => {
    render(<Avatar name="Camila Ribeiro" id="u-camila" />);
    expect(screen.queryByText('CR')).toBeNull();
    expect(isHiddenFromAccessibility(screen.getByText('CR', hidden))).toBe(true);
  });

  it('as iniciais não crescem com a fonte do sistema', () => {
    render(<Avatar name="Camila Ribeiro" id="u-camila" size="hero" />);
    const initials = screen.getByText('CR', hidden);
    expect(initials).toHaveProp('maxFontSizeMultiplier', 1);
    expect(initials).toHaveStyle({ fontSize: layout.avatar.hero.initials });
  });

  it('o anel de marca é o gradiente rosa para lima e o miolo encolhe dentro dele', () => {
    render(<Avatar name="Camila Ribeiro" id="u-camila" size="xl" ring="brand" />);
    expect(screen.UNSAFE_getByType(LinearGradient).props.colors).toEqual(
      gradients.brandRing.colors,
    );
    // Miolo de 36 dentro do anel de 2 (1b).
    expect(faceStyle('CR').width).toBe(layout.avatar.xl.size - 2 * layout.avatarRing.brand);
  });

  it('o anel do 1º do pódio é lima e o do próprio fã é rosa', () => {
    const { rerender } = render(
      <Avatar name="Thalita S." id="u-thalita" size="podiumFirst" ring="points" />,
    );
    expect(styleAbove('TS', 2).backgroundColor).toBe(colors.points);
    // Anel lima de 2,5: miolo de 57 no avatar de 62 (1f).
    expect(faceStyle('TS').width).toBe(57);

    rerender(<Avatar name="Thalita S." id="u-thalita" size="podiumFirst" ring="self" />);
    expect(styleAbove('TS', 2).backgroundColor).toBe(colors.accent);
  });

  it('o fundo passado por prop vence a paleta (card "Você" sobre rosa)', () => {
    render(<Avatar name="Camila Ribeiro" id="u-camila" fallbackColor={colors.glassDark} />);
    expect(faceStyle('CR').backgroundColor).toBe(colors.glassDark);
  });
});

describe('AvatarStack', () => {
  const people = [
    { id: 'rock-salles', name: 'Rock Salles' },
    { id: 'juninho-moraes', name: 'Juninho Moraes' },
    { id: 'nenho', name: 'Nenho' },
  ];

  it('mostra um avatar por pessoa, na ordem, cada um sobre o anterior', () => {
    render(<AvatarStack people={people} />);
    // Círculo, caixa oculta do Avatar e a borda da pilha.
    const wrappers = ['RS', 'JM', 'N'].map((initials) => styleAbove(initials, 3));
    expect(wrappers[0]?.marginLeft).toBeUndefined();
    expect(wrappers[1]?.marginLeft).toBe(-layout.avatarStackOverlap);
    expect(wrappers[2]?.marginLeft).toBe(-layout.avatarStackOverlap);
    for (const style of wrappers) expect(style?.borderColor).toBe(colors.background);
  });

  it('fica oculta do leitor de tela', () => {
    render(<AvatarStack people={people} />);
    expect(screen.queryByText('RS')).toBeNull();
    expect(isHiddenFromAccessibility(screen.getByText('RS', hidden))).toBe(true);
  });
});
