import { fireEvent, render, screen } from '@testing-library/react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, StyleSheet } from 'react-native';
import * as Reanimated from 'react-native-reanimated';

import type { Artist } from '@/domains/artists';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { gradients, layout } from '@/theme';

import { ArtistSelectCard } from '../components/artist-select-card';
import { MoreArtistsCard } from '../components/more-artists-card';
import { SearchArtistsCard } from '../components/search-artists-card';

// O build do Firebase que o Jest resolve é ESM. O card não fala com ele, mas os
// textos do card vêm do index do domínio de artistas, que chega à API.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));

const netto: Artist = {
  id: 'nettobrito',
  name: 'Netto Brito',
  photoURL: null,
  fanCount: 412_000,
  order: 0,
};

const cardName = t('onboarding.chooseArtists.cardLabel', { name: 'Netto Brito', fans: '412 mil' });

const nenho: Artist = { id: 'nenho', name: 'Nenho', photoURL: null, fanCount: 298_000, order: 1 };

// A altura da grade da 1l numa tela de 393 de largura (4:5 da coluna).
const HEIGHT = 211;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('card de artista da 1l', () => {
  it('mostra o nome e os fãs, e o leitor ouve os dois num foco só', () => {
    render(
      <ArtistSelectCard height={HEIGHT} artist={netto} selected={false} onToggle={jest.fn()} />,
    );
    expect(screen.getByText('Netto Brito')).toBeOnTheScreen();
    expect(screen.getByText('412 mil fãs')).toBeOnTheScreen();
    expect(screen.getAllByLabelText(cardName)).toHaveLength(1);
  });

  it('com a fonte grande, o nome quebra em até 2 linhas em vez de sumir nas reticências', () => {
    render(
      <ArtistSelectCard height={HEIGHT} artist={netto} selected={false} onToggle={jest.fn()} />,
    );
    expect(screen.getByText('Netto Brito')).toHaveProp('numberOfLines', 2);
    expect(screen.getByText('412 mil fãs')).toHaveProp('numberOfLines', 1);
  });

  it('marcar anima a marca; o card reaproveitado para outro artista (FlashList) não anima', () => {
    const spring = jest.spyOn(Reanimated, 'withSpring');
    const view = render(
      <ArtistSelectCard height={HEIGHT} artist={netto} selected={false} onToggle={jest.fn()} />,
    );
    spring.mockClear();

    view.rerender(
      <ArtistSelectCard height={HEIGHT} artist={netto} selected onToggle={jest.fn()} />,
    );
    expect(spring).toHaveBeenCalledTimes(1);

    // A mesma célula passa a mostrar outro artista, que não está escolhido.
    view.rerender(
      <ArtistSelectCard height={HEIGHT} artist={nenho} selected={false} onToggle={jest.fn()} />,
    );
    expect(spring).toHaveBeenCalledTimes(1);
    expect(
      screen.getByLabelText(
        t('onboarding.chooseArtists.cardLabel', { name: 'Nenho', fans: '298 mil' }),
      ),
    ).toBeOnTheScreen();
  });

  it('no iOS é botão com "selecionado"', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    render(<ArtistSelectCard height={HEIGHT} artist={netto} selected onToggle={jest.fn()} />);
    expect(screen.getByRole('button', { name: cardName, selected: true })).toBeOnTheScreen();
  });

  it('no Android é caixa de marcar', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    render(
      <ArtistSelectCard height={HEIGHT} artist={netto} selected={false} onToggle={jest.fn()} />,
    );
    expect(screen.getByRole('checkbox', { name: cardName, checked: false })).toBeOnTheScreen();
  });

  it('tocar troca a escolha daquele artista, com o toque de seleção', () => {
    const onToggle = jest.fn();
    render(
      <ArtistSelectCard height={HEIGHT} artist={netto} selected={false} onToggle={onToggle} />,
    );
    fireEvent.press(screen.getByLabelText(cardName));
    expect(onToggle).toHaveBeenCalledWith('nettobrito');
    expect(haptics.trigger).toHaveBeenCalledWith('selection');
  });

  it('travado enquanto a escolha é salva', () => {
    const onToggle = jest.fn();
    render(
      <ArtistSelectCard height={HEIGHT} artist={netto} selected onToggle={onToggle} disabled />,
    );
    const card = screen.getByLabelText(cardName);
    expect(card).toBeDisabled();
    fireEvent.press(card);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('tem a altura da grade, e o único véu é o do texto, preso ao topo dele (a foto fica limpa)', () => {
    render(
      <ArtistSelectCard height={HEIGHT} artist={netto} selected={false} onToggle={jest.fn()} />,
    );
    expect(screen.getByLabelText(cardName)).toHaveStyle({ height: HEIGHT });
    const [veil, ...others] = screen.UNSAFE_getAllByType(LinearGradient);
    expect(others).toHaveLength(0);
    expect(veil.props.colors).toEqual(gradients.scrims.centralTileCopy.colors);
    const { fade, below } = layout.centralTileVeil;
    expect(StyleSheet.flatten(veil.props.style)).toMatchObject({
      top: -fade,
      height: fade + below,
    });
  });

  it('dentro do card nada mais é tocável nem tem papel próprio', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    render(<ArtistSelectCard height={HEIGHT} artist={netto} selected onToggle={jest.fn()} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.queryAllByRole('image')).toHaveLength(0);
  });
});

describe('células tracejadas da 1l', () => {
  const rest: Artist[] = [5, 6, 7].map((number) => ({
    id: `artista${number}`,
    name: `Artista ${number}`,
    photoURL: null,
    fanCount: 1_000,
    order: number,
  }));

  it('"+18 artistas" é um alvo só, que diz quantos são e abre a lista', () => {
    const onPress = jest.fn();
    render(<MoreArtistsCard preview={rest} count={18} onPress={onPress} />);

    expect(screen.getByText('+18 artistas')).toBeOnTheScreen();
    expect(screen.getByText(t('onboarding.chooseArtists.seeAll'))).toBeOnTheScreen();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveProp(
      'accessibilityLabel',
      t('onboarding.chooseArtists.moreLabel', { count: 18 }),
    );
    fireEvent.press(buttons[0]!);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('sem foto, ficam com 154 de altura mínima e esticam até a fileira de um card de artista', () => {
    render(<SearchArtistsCard onPress={jest.fn()} />);
    expect(
      screen.getByRole('button', { name: t('onboarding.chooseArtists.searchLabel') }),
    ).toHaveStyle({ minHeight: layout.artistTileHeight, flexGrow: 1 });
  });

  it('"Buscar por nome" diz o que faz, começando pelo texto que se vê (comando de voz)', () => {
    const onPress = jest.fn();
    render(<SearchArtistsCard onPress={onPress} />);
    const label = t('onboarding.chooseArtists.searchLabel');
    expect(label.startsWith(t('onboarding.chooseArtists.search'))).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: label }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
