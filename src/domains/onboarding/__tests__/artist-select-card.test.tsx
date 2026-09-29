import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import * as Reanimated from 'react-native-reanimated';

import type { Artist } from '@/domains/artists';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';

import { ArtistSelectCard } from '../components/artist-select-card';
import { MoreArtistsCard } from '../components/more-artists-card';
import { SearchArtistsCard } from '../components/search-artists-card';

const netto: Artist = {
  id: 'netto-brito',
  name: 'Netto Brito',
  photoURL: null,
  fanCount: 412_000,
  order: 0,
};

const cardName = t('onboarding.chooseArtists.cardLabel', { name: 'Netto Brito', fans: '412 mil' });

const nenho: Artist = { id: 'nenho', name: 'Nenho', photoURL: null, fanCount: 298_000, order: 1 };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('card de artista da 1l', () => {
  it('mostra o nome e os fãs, e o leitor ouve os dois num foco só', () => {
    render(<ArtistSelectCard artist={netto} selected={false} onToggle={jest.fn()} />);
    expect(screen.getByText('Netto Brito')).toBeOnTheScreen();
    expect(screen.getByText('412 mil fãs')).toBeOnTheScreen();
    expect(screen.getAllByLabelText(cardName)).toHaveLength(1);
  });

  it('com a fonte grande, o nome quebra em até 2 linhas em vez de sumir nas reticências', () => {
    render(<ArtistSelectCard artist={netto} selected={false} onToggle={jest.fn()} />);
    expect(screen.getByText('Netto Brito')).toHaveProp('numberOfLines', 2);
    expect(screen.getByText('412 mil fãs')).toHaveProp('numberOfLines', 1);
  });

  it('marcar anima a marca; o card reaproveitado para outro artista (FlashList) não anima', () => {
    const spring = jest.spyOn(Reanimated, 'withSpring');
    const view = render(<ArtistSelectCard artist={netto} selected={false} onToggle={jest.fn()} />);
    spring.mockClear();

    view.rerender(<ArtistSelectCard artist={netto} selected onToggle={jest.fn()} />);
    expect(spring).toHaveBeenCalledTimes(1);

    // A mesma célula passa a mostrar outro artista, que não está escolhido.
    view.rerender(<ArtistSelectCard artist={nenho} selected={false} onToggle={jest.fn()} />);
    expect(spring).toHaveBeenCalledTimes(1);
    expect(
      screen.getByLabelText(
        t('onboarding.chooseArtists.cardLabel', { name: 'Nenho', fans: '298 mil' }),
      ),
    ).toBeOnTheScreen();
  });

  it('no iOS é botão com "selecionado"', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    render(<ArtistSelectCard artist={netto} selected onToggle={jest.fn()} />);
    expect(screen.getByRole('button', { name: cardName, selected: true })).toBeOnTheScreen();
  });

  it('no Android é caixa de marcar', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    render(<ArtistSelectCard artist={netto} selected={false} onToggle={jest.fn()} />);
    expect(screen.getByRole('checkbox', { name: cardName, checked: false })).toBeOnTheScreen();
  });

  it('tocar troca a escolha daquele artista, com o toque de seleção', () => {
    const onToggle = jest.fn();
    render(<ArtistSelectCard artist={netto} selected={false} onToggle={onToggle} />);
    fireEvent.press(screen.getByLabelText(cardName));
    expect(onToggle).toHaveBeenCalledWith('netto-brito');
    expect(haptics.trigger).toHaveBeenCalledWith('selection');
  });

  it('travado enquanto a escolha é salva', () => {
    const onToggle = jest.fn();
    render(<ArtistSelectCard artist={netto} selected onToggle={onToggle} disabled />);
    const card = screen.getByLabelText(cardName);
    expect(card).toBeDisabled();
    fireEvent.press(card);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('dentro do card nada mais é tocável nem tem papel próprio', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    render(<ArtistSelectCard artist={netto} selected onToggle={jest.fn()} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.queryAllByRole('image')).toHaveLength(0);
  });
});

describe('células tracejadas da 1l', () => {
  const rest: Artist[] = [5, 6, 7].map((number) => ({
    id: `artista-${number}`,
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

  it('"Buscar por nome" diz o que faz, começando pelo texto que se vê (comando de voz)', () => {
    const onPress = jest.fn();
    render(<SearchArtistsCard onPress={onPress} />);
    const label = t('onboarding.chooseArtists.searchLabel');
    expect(label.startsWith(t('onboarding.chooseArtists.search'))).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: label }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
