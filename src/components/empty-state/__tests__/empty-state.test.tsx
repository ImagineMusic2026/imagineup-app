import { fireEvent, render, screen } from '@testing-library/react-native';
import { MessageCircle } from 'lucide-react-native';

import { colors } from '@/theme';

import { EmptyState } from '..';

describe('EmptyState', () => {
  it('vazio: mostra a mensagem, sem botão quando não há rótulo de ação', () => {
    render(
      <EmptyState
        icon={MessageCircle}
        message="Ninguém comentou ainda. Comece a conversa."
        onAction={jest.fn()}
      />,
    );

    expect(screen.getByText('Ninguém comentou ainda. Comece a conversa.')).toHaveStyle({
      color: colors.textTertiary,
    });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('vazio com ação: o botão leva o rótulo de quem chama', () => {
    const onAction = jest.fn();
    render(
      <EmptyState
        message="Você ainda não entrou em nenhuma central."
        actionLabel="Escolher artistas"
        onAction={onAction}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Escolher artistas' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('erro: oferece "Tentar de novo" por padrão', () => {
    const onAction = jest.fn();
    render(
      <EmptyState tone="error" message="Não deu para carregar as missões." onAction={onAction} />,
    );

    expect(screen.getByText('Não deu para carregar as missões.')).toHaveStyle({
      color: colors.textSecondary,
    });
    fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('tentando de novo, o botão fica na tela, ocupado e sem disparar outra vez', () => {
    const onAction = jest.fn();
    render(
      <EmptyState
        tone="error"
        message="Não foi possível carregar os artistas."
        onAction={onAction}
        actionLoading
      />,
    );

    const retry = screen.getByRole('button', { name: 'Tentar de novo' });
    expect(retry).toBeBusy();
    fireEvent.press(retry);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('erro sem onAction não desenha botão', () => {
    render(<EmptyState tone="error" message="Não deu para carregar as recompensas." />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('título e mensagem são um foco só para o leitor de tela', () => {
    render(
      <EmptyState
        tone="error"
        title="Algo deu errado"
        message="Tente de novo. Se continuar, feche e abra o app."
        onAction={jest.fn()}
      />,
    );

    expect(
      screen.getByLabelText('Algo deu errado. Tente de novo. Se continuar, feche e abra o app.'),
    ).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
