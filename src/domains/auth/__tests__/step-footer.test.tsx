import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { colors, layout, opacities, radii, spacing } from '@/theme';

import { StepFooter, type StepFooterProps } from '../components/step-footer';

const BACK = t('common.back');
const NEXT = t('common.continue');

const back = () => screen.getByRole('button', { name: BACK });
const next = () => screen.getByRole('button', { name: NEXT });

function footer(props: Partial<StepFooterProps> = {}) {
  return <StepFooter onBack={jest.fn()} label={NEXT} onPress={jest.fn()} {...props} />;
}

/** O círculo desenhado dentro do voltar (em host). */
function circle() {
  const [box, ...others] = screen.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      StyleSheet.flatten(node.props.style)?.borderRadius === radii.pill,
  );
  if (!box || others.length > 0) throw new Error('o voltar devia ter um círculo só');
  return box;
}

describe('pé das perguntas da entrada', () => {
  afterEach(() => jest.restoreAllMocks());

  it('o voltar vem antes do botão, cada um com o próprio rótulo', () => {
    render(footer());
    expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([
      BACK,
      NEXT,
    ]);
  });

  it('cada um faz o seu: o voltar volta e o botão avança', () => {
    const onBack = jest.fn();
    const onPress = jest.fn();
    render(footer({ onBack, onPress }));

    fireEvent.press(back());
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();

    fireEvent.press(next());
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('o voltar é um círculo de vidro da altura do botão, a 12 dele', () => {
    render(footer());
    expect(back()).toHaveStyle({
      width: layout.buttonHeight.lg,
      height: layout.buttonHeight.lg,
    });
    expect(circle()).toHaveStyle({
      flex: 1,
      backgroundColor: colors.glass,
      borderColor: colors.borderGlass,
    });
    expect(screen.root).toHaveStyle({ flexDirection: 'row', gap: spacing.md });
  });

  it('o botão ocupa o resto da fileira', () => {
    render(footer());
    expect(next()).toHaveStyle({ flex: 1 });
  });

  it('sem para onde voltar (o estágio do convite recusado), fica só o botão', () => {
    render(<StepFooter label={NEXT} onPress={jest.fn()} />);
    expect(screen.queryByRole('button', { name: BACK })).toBeNull();
    expect(next()).toBeTruthy();
  });

  it('com o campo vazio, o botão apaga, não avança e diz por quê', () => {
    const onPress = jest.fn();
    const hint = t('auth.emptyHint');
    render(footer({ onPress, disabled: true, accessibilityHint: hint }));

    fireEvent.press(next());
    expect(onPress).not.toHaveBeenCalled();
    expect(next()).toBeDisabled();
    expect(next()).toHaveProp('accessibilityHint', hint);
    // O voltar continua valendo.
    expect(back()).toBeEnabled();
  });

  it('enviando, o botão fica ocupado e não aceita outro toque', () => {
    const onPress = jest.fn();
    render(footer({ onPress, loading: true }));

    fireEvent.press(next());
    expect(onPress).not.toHaveBeenCalled();
    expect(next()).toBeBusy();
  });

  it('com o voltar travado (a conta sendo criada), ele apaga e não volta', () => {
    const onBack = jest.fn();
    render(footer({ onBack, backDisabled: true }));

    fireEvent.press(back());
    expect(onBack).not.toHaveBeenCalled();
    expect(back()).toBeDisabled();
    expect(back()).toHaveStyle({ opacity: opacities.disabled });
  });

  it('o botão não vibra (o toque do envio sai do resultado); o voltar vibra de leve', () => {
    const trigger = jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
    render(footer());

    fireEvent.press(next());
    expect(trigger).not.toHaveBeenCalled();

    fireEvent.press(back());
    expect(trigger).toHaveBeenCalledWith('tap');
  });
});
