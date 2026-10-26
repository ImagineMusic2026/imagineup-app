import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Linking } from 'react-native';

import { haptics } from '@/services/haptics';

import { SocialIcons } from '../components/social-icons';
import type { FanSocials } from '../types';

// Os links só abrem com a API de verdade; as fixtures e o emulador mostram os ícones sem toque.
let mockDataSource: 'api' | 'fixtures' = 'api';
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

const SOCIALS: FanSocials = {
  instagram: 'camila.teste.up',
  tiktok: null,
  linkedin: 'camila-teste-imagineup',
  x: 'camilatesteup',
};

const hidden = { includeHiddenElements: true } as const;

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'api';
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('SocialIcons (as redes no topo da 1e)', () => {
  it('um link por rede preenchida, na ordem da lista fixa, que abre o perfil fora do app', () => {
    render(<SocialIcons socials={SOCIALS} />);

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.props.accessibilityLabel)).toEqual([
      'Instagram, @camila.teste.up',
      'LinkedIn, in/camila-teste-imagineup',
      'X (Twitter), @camilatesteup',
    ]);
    expect(links[0]).toHaveProp('accessibilityHint', 'Abre o perfil no Instagram, fora do app');

    fireEvent.press(screen.getByRole('link', { name: 'Instagram, @camila.teste.up' }));
    expect(Linking.openURL).toHaveBeenCalledWith('https://www.instagram.com/camila.teste.up/');
    fireEvent.press(screen.getByRole('link', { name: 'X (Twitter), @camilatesteup' }));
    expect(Linking.openURL).toHaveBeenLastCalledWith('https://x.com/camilatesteup');
    expect(screen.queryByText(/Perfil de exemplo/, hidden)).toBeNull();
  });

  it('sem rede preenchida (ou fora do padrão), nada aparece', () => {
    const { rerender } = render(<SocialIcons testID="socials" socials={null} />);
    expect(screen.queryByTestId('socials')).toBeNull();

    rerender(
      <SocialIcons
        testID="socials"
        socials={{ instagram: 'não é usuário', tiktok: null, linkedin: null, x: null }}
      />,
    );
    expect(screen.queryByTestId('socials')).toBeNull();
  });

  it('nas fixtures, os ícones ficam sem toque, com o mesmo rótulo e o aviso de exemplo', () => {
    mockDataSource = 'fixtures';
    render(<SocialIcons socials={SOCIALS} />);

    expect(screen.queryByRole('link')).toBeNull();
    const instagram = screen.getByLabelText('Instagram, @camila.teste.up');
    expect(instagram).toHaveProp('accessible', true);
    fireEvent.press(instagram);
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(screen.getByText('Perfil de exemplo: os links não abrem nesta versão.')).toBeTruthy();
  });

  it('o link que não abre mostra o aviso embaixo, anunciado, com o toque de erro', async () => {
    jest.mocked(Linking.openURL).mockRejectedValue(new Error('sem app'));
    render(<SocialIcons socials={SOCIALS} />);

    fireEvent.press(screen.getByRole('link', { name: 'LinkedIn, in/camila-teste-imagineup' }));

    expect(await screen.findByText('Não deu para abrir o link.')).toBeTruthy();
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
        'Não deu para abrir o link.',
        { queue: true },
      ),
    );
  });
});
