import { render, screen } from '@testing-library/react-native';
import type * as Reanimated from 'react-native-reanimated';

import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { colors, radii } from '@/theme';

import { Skeleton, SkeletonGroup } from '..';

jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: jest.fn(() => false),
}));

const reanimated: typeof Reanimated = jest.requireMock('react-native-reanimated');

describe('Skeleton', () => {
  let withRepeat: jest.SpyInstance;

  beforeEach(() => {
    jest.mocked(usePrefersReducedMotion).mockReturnValue(false);
    withRepeat = jest.spyOn(reanimated, 'withRepeat');
  });

  afterEach(() => jest.restoreAllMocks());

  it('o grupo é um foco só, que diz "Carregando", e os blocos ficam fora do leitor', () => {
    render(
      <SkeletonGroup>
        <Skeleton height={12} testID="barra" />
        <Skeleton height={9} width="40%" testID="barra-curta" />
      </SkeletonGroup>,
    );

    expect(screen.getByLabelText('Carregando')).toBeBusy();
    expect(screen.queryByTestId('barra')).toBeNull();
    expect(screen.getByTestId('barra', { includeHiddenElements: true })).toBeTruthy();
  });

  it('o grupo aceita outro texto para o leitor', () => {
    render(
      <SkeletonGroup accessibilityLabel="Carregando missões">
        <Skeleton height={12} />
      </SkeletonGroup>,
    );
    expect(screen.getByLabelText('Carregando missões')).toBeTruthy();
  });

  it('dentro do grupo, a tela pulsa junto: um pulso só para todos os blocos', () => {
    render(
      <SkeletonGroup>
        <Skeleton height={12} />
        <Skeleton height={12} />
        <Skeleton height={12} />
      </SkeletonGroup>,
    );
    expect(withRepeat).toHaveBeenCalledTimes(1);
  });

  it('sozinho, o bloco pulsa por conta própria', () => {
    render(<Skeleton height={64} />);
    expect(withRepeat).toHaveBeenCalledTimes(1);
  });

  it('com reduzir movimento, fica parado', () => {
    jest.mocked(usePrefersReducedMotion).mockReturnValue(true);
    render(
      <SkeletonGroup>
        <Skeleton height={12} testID="barra" />
      </SkeletonGroup>,
    );

    expect(withRepeat).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Carregando')).toHaveStyle({ opacity: 1 });
  });

  it('o círculo tem a largura da altura e raio cheio', () => {
    render(<Skeleton circle height={34} testID="avatar" />);
    expect(screen.getByTestId('avatar', { includeHiddenElements: true })).toHaveStyle({
      width: 34,
      height: 34,
      borderRadius: radii.pill,
    });
  });

  it.each([
    ['surface', colors.surface],
    ['raised', colors.surfaceRaised],
    ['sunken', colors.surfaceSunken],
    ['line', colors.skeletonLine],
  ] as const)('o tom %s pinta o bloco com a cor do tema', (tone, backgroundColor) => {
    render(<Skeleton tone={tone} height={12} radius={radii.lg} testID="bloco" />);
    expect(screen.getByTestId('bloco', { includeHiddenElements: true })).toHaveStyle({
      backgroundColor,
      borderRadius: radii.lg,
      width: '100%',
    });
  });
});
