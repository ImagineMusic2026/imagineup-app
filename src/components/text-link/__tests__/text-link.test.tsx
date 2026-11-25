import { fireEvent, render, screen } from '@testing-library/react-native';
import { Ticket } from 'lucide-react-native';

import { Text } from '@/components/text';
import { haptics } from '@/services/haptics';
import { colors, layout, typography } from '@/theme';
import { withAlpha } from '@/utils/color';

import { TextLink } from '..';

describe('TextLink', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sozinho na linha: alvo de 44, papel de botão e rosa de ação', () => {
    const onPress = jest.fn();
    render(<TextLink label="Esqueci minha senha" onPress={onPress} />);

    const link = screen.getByRole('button', { name: 'Esqueci minha senha' });
    expect(link).toHaveStyle({
      minHeight: layout.minTouchTarget,
      minWidth: layout.minTouchTarget,
    });
    expect(screen.getByText('Esqueci minha senha')).toHaveStyle({
      ...typography.label,
      color: colors.accent,
    });
    fireEvent.press(link);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('sozinho, aceita papel de link, variante de texto e rótulo mais completo', () => {
    render(
      <TextLink
        label="Ver todos"
        role="link"
        textVariant="micro"
        accessibilityLabel="Ver todos os artistas"
        onPress={jest.fn()}
      />,
    );

    expect(screen.getByRole('link', { name: 'Ver todos os artistas' })).toBeTruthy();
    expect(screen.getByText('Ver todos')).toHaveStyle(typography.micro);
  });

  it('sozinho, vibra de leve no toque', () => {
    const trigger = jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
    render(<TextLink label="Ver agenda completa" onPress={jest.fn()} />);

    fireEvent.press(screen.getByRole('button', { name: 'Ver agenda completa' }));
    expect(trigger).toHaveBeenCalledWith('tap');
  });

  it('no meio do texto: vira um trecho com papel de link, sem vibrar', () => {
    const trigger = jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
    const onPress = jest.fn();
    render(
      <Text variant="caption" color={colors.textMuted}>
        Ao continuar, você aceita os{' '}
        <TextLink
          variant="inline"
          tone="text"
          textVariant="labelSmall"
          label="Termos de uso"
          onPress={onPress}
        />
      </Text>,
    );

    fireEvent.press(screen.getByRole('link', { name: 'Termos de uso' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(trigger).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('sozinho, com ícone: ele vem antes do texto, na cor dele e a 7, e o leitor ouve só o rótulo', () => {
    render(<TextLink label="Tenho um código de convite" icon={Ticket} onPress={jest.fn()} />);
    const link = screen.getByRole('button', { name: 'Tenho um código de convite' });
    const icon = link.findByType(Ticket);
    expect(icon.props).toMatchObject({ size: 16, color: colors.accent });
    // A caixa (em host) em volta do texto: a fileira do ícone com ele.
    let row = screen.getByText('Tenho um código de convite').parent;
    while (row && typeof row.type !== 'string') row = row.parent;
    expect(row).toHaveStyle({ flexDirection: 'row', alignItems: 'center', gap: 7 });
  });

  it('o tom de texto vem sublinhado; o rosa, não', () => {
    render(
      <Text>
        <TextLink
          variant="inline"
          tone="text"
          label="Política de privacidade"
          onPress={jest.fn()}
        />{' '}
        <TextLink variant="inline" label="Criar conta" onPress={jest.fn()} />
      </Text>,
    );

    expect(screen.getByText('Política de privacidade')).toHaveStyle({
      color: colors.text,
      textDecorationLine: 'underline',
      textDecorationColor: withAlpha(colors.text, 0.35),
    });
    expect(screen.getByText('Criar conta')).toHaveStyle({ color: colors.accent });
    expect(screen.getByText('Criar conta')).not.toHaveStyle({ textDecorationLine: 'underline' });
  });

  it('desativado, o avulso apaga e não dispara', () => {
    const onPress = jest.fn();
    render(<TextLink label="Ver ranking" disabled onPress={onPress} />);

    const link = screen.getByRole('button', { name: 'Ver ranking' });
    expect(link).toBeDisabled();
    fireEvent.press(link);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('desativado, o trecho dentro do texto perde o toque e apaga pela cor', () => {
    render(
      <Text>
        <TextLink variant="inline" label="Criar conta" disabled onPress={jest.fn()} />
      </Text>,
    );

    const link = screen.getByText('Criar conta');
    expect(link).toHaveStyle({ color: colors.textMuted });
    expect(link.props.onPress).toBeUndefined();
    expect(link).toBeDisabled();
  });
});
