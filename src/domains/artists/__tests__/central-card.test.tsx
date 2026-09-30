import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { colors, layout } from '@/theme';

import { CentralCard, centralCardMetrics } from '../components/central-card';
import type { FanCentral } from '../types';

// Só a navegação imperativa sai do ar; o resto (tema de navegação) é o de verdade.
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn() },
}));

const NETTO: FanCentral = {
  artistId: 'netto-brito',
  name: 'Netto Brito',
  shortName: null,
  photoURL: null,
  fanCount: 412_000,
  fanRank: 12,
  seasonPoints: 4_120,
};

const JUNINHO: FanCentral = {
  artistId: 'juninho-moraes',
  name: 'Juninho Moraes',
  shortName: 'Juninho M.',
  photoURL: null,
  fanCount: 141_000,
  fanRank: null,
  seasonPoints: 0,
};

beforeEach(() => jest.clearAllMocks());

describe('CentralCard', () => {
  it('o card inteiro é um alvo só: "Netto Brito, você é o 12º"', () => {
    render(<CentralCard central={NETTO} />);
    expect(screen.getByRole('button', { name: 'Netto Brito, você é o 12º' })).toBeTruthy();
    expect(screen.getByText('você é #12')).toHaveStyle({ color: colors.points });
  });

  it('sem posição, "novo" em cinza e "central nova" para o leitor, com o nome curto no card', () => {
    render(<CentralCard central={JUNINHO} />);
    expect(screen.getByRole('button', { name: 'Juninho Moraes, central nova' })).toBeTruthy();
    expect(screen.getByText('Juninho M.')).toBeTruthy();
    expect(screen.getByText('novo')).toHaveStyle({ color: colors.textMuted });
  });

  it('sem foto, as iniciais do artista ficam como imagem, fora do leitor', () => {
    render(<CentralCard central={NETTO} />);
    expect(screen.queryByText('NB')).toBeNull();
    expect(screen.getByText('NB', { includeHiddenElements: true })).toBeTruthy();
  });

  it('com a fonte padrão, é o card do protótipo: 112 de largura, nome numa linha e 128 de altura', () => {
    expect(centralCardMetrics(1)).toEqual({
      width: layout.centralCard.width,
      imageWidth: layout.centralCard.imageWidth,
      imageHeight: layout.centralCard.imageHeight,
      nameLines: 1,
      // Borda 2, padding 22, imagem 66, 9, nome 15, 2 e posição 12.
      minHeight: 128,
    });
  });

  it('com a fonte a 200%, alarga até 1,4 vez e o nome quebra em duas linhas em vez de cortar', () => {
    const large = centralCardMetrics(2);
    expect(large.width).toBeCloseTo(layout.centralCard.width * 1.4);
    expect(large.imageHeight).toBeCloseTo(layout.centralCard.imageHeight * 1.4);
    expect(large.nameLines).toBe(2);
    expect(large.minHeight).toBeGreaterThan(centralCardMetrics(1).minHeight);
  });

  it('tocar abre o artista', () => {
    render(<CentralCard central={NETTO} />);
    fireEvent.press(screen.getByRole('button', { name: 'Netto Brito, você é o 12º' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/artista/[artistaId]',
      params: { artistaId: 'netto-brito' },
    });
  });
});
