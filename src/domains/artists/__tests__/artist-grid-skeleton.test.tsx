import { render, screen } from '@testing-library/react-native';

import { ArtistGridSkeleton } from '../components/artist-grid-skeleton';

const cards = () =>
  screen.getAllByTestId('artist-grid-skeleton-card', { includeHiddenElements: true });

describe('ArtistGridSkeleton', () => {
  it('um foco só, com a frase de quem chama, e os cards na altura da grade da 1l', () => {
    // A altura da grade da 1l numa tela de 393 de largura.
    render(
      <ArtistGridSkeleton count={4} tileHeight={211} accessibilityLabel="Carregando os artistas" />,
    );
    expect(screen.getByLabelText('Carregando os artistas')).toBeOnTheScreen();
    expect(cards()).toHaveLength(4);
    for (const card of cards()) expect(card).toHaveStyle({ height: 211 });
  });

  it('na Explorar, os cards têm a altura da grade (4:5 da coluna), para nada pular', () => {
    // A altura da grade da Explorar numa tela de 393 de largura.
    const height = 216;
    render(<ArtistGridSkeleton count={6} tileHeight={height} accessibilityLabel="Carregando" />);
    expect(cards()).toHaveLength(6);
    for (const card of cards()) expect(card).toHaveStyle({ height });
  });
});
