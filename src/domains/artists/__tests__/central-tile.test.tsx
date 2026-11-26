import { fireEvent, render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { gradients, layout } from '@/theme';

import { CentralTile } from '../components/central-tile';
import type { Artist } from '../types';

// Só a navegação imperativa sai do ar; o resto (tema de navegação) é o de verdade.
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn() },
}));

const NETTO: Artist = {
  id: 'nettobrito',
  name: 'Netto Brito',
  photoURL: null,
  fanCount: 412_000,
  order: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('CentralTile', () => {
  it('fora da central: um alvo só com o nome e os fãs, sem a marca', () => {
    render(<CentralTile artist={NETTO} member={false} />);
    const tile = screen.getByRole('button', { name: 'Netto Brito, 412 mil fãs' });
    expect(tile).toHaveProp('accessibilityHint', t('explore.tileHint'));
    expect(screen.getByText('Netto Brito')).toBeOnTheScreen();
    expect(screen.getByText('412 mil fãs')).toBeOnTheScreen();
    expect(screen.queryByText(t('explore.member'))).toBeNull();
    // Nada pressável dentro do card.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('na central: a pílula "Na central", e o leitor ouve isso no mesmo foco', () => {
    render(<CentralTile artist={{ ...NETTO, fanCount: 1 }} member />);
    expect(
      screen.getByRole('button', { name: 'Netto Brito, 1 fã, você está na central' }),
    ).toBeOnTheScreen();
    expect(screen.getByText(t('explore.member'))).toBeOnTheScreen();
    expect(screen.getByText('1 fã')).toBeOnTheScreen();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('a foto ocupa o card todo, sem véu por cima: o único véu é o do texto, preso ao topo dele', () => {
    render(<CentralTile artist={NETTO} member />);
    const [veil, ...others] = screen.UNSAFE_getAllByType(LinearGradient);
    expect(others).toHaveLength(0);
    expect(veil.props.colors).toEqual(gradients.scrims.centralTileCopy.colors);
    const { fade, below } = layout.centralTileVeil;
    expect(StyleSheet.flatten(veil.props.style)).toMatchObject({
      top: -fade,
      height: fade + below,
    });
  });

  it('a foto 3:4 sobe um quarto da sobra, para o rosto sair acima do texto', () => {
    render(
      <CentralTile artist={{ ...NETTO, photoURL: 'https://example.com/netto.jpg' }} member={false} />,
    );
    expect(screen.UNSAFE_getByType(Image).props.contentPosition).toEqual({
      top: '25%',
      left: '50%',
    });
  });

  it('tocar abre a central', () => {
    render(<CentralTile artist={NETTO} member={false} />);
    fireEvent.press(screen.getByRole('button', { name: 'Netto Brito, 412 mil fãs' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/artista/[artistaId]',
      params: { artistaId: 'nettobrito' },
    });
    expect(haptics.trigger).toHaveBeenCalledWith('tap');
  });
});
