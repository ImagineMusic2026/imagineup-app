import { fireEvent, render, screen } from '@testing-library/react-native';
import { Gift, Target, UserPlus } from 'lucide-react-native';
import { useSharedValue } from 'react-native-reanimated';

import { CenterMenu, type CenterMenuAction } from '../center-menu';

const actions: CenterMenuAction[] = [
  { key: 'invite', label: 'Convidar', icon: UserPlus, color: '#FF2D6F', onPress: jest.fn() },
  { key: 'missions', label: 'Missões', icon: Target, color: '#D6FF3F', onPress: jest.fn() },
  { key: 'rewards', label: 'Recompensas', icon: Gift, color: '#D6FF3F', onPress: jest.fn() },
];

function Harness({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (action: CenterMenuAction) => void;
}) {
  const progress = useSharedValue(open ? 1 : 0);
  return (
    <CenterMenu
      open={open}
      progress={progress}
      actions={actions}
      bottomOffset={80}
      onClose={onClose}
      onSelect={onSelect}
    />
  );
}

describe('menu do "+"', () => {
  it('aberto, mostra os atalhos e entrega o escolhido', () => {
    const onSelect = jest.fn();
    render(<Harness open onClose={jest.fn()} onSelect={onSelect} />);

    for (const label of ['Convidar', 'Missões', 'Recompensas']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    fireEvent.press(screen.getByLabelText('Missões'));
    expect(onSelect).toHaveBeenCalledWith(actions[1]);
  });

  it('tocar fora fecha o menu', () => {
    const onClose = jest.fn();
    render(<Harness open onClose={onClose} onSelect={jest.fn()} />);
    fireEvent.press(screen.getByLabelText('Fechar atalhos'));
    expect(onClose).toHaveBeenCalled();
  });

  it('fechado, some para o leitor de tela', () => {
    render(<Harness open={false} onClose={jest.fn()} onSelect={jest.fn()} />);
    expect(screen.queryByLabelText('Convidar')).toBeNull();
    expect(screen.queryByLabelText('Fechar atalhos')).toBeNull();
  });
});
