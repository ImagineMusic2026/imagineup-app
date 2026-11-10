import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Check } from 'lucide-react-native';

import { borderWidths, colors, tints } from '@/theme';
import { withAlpha } from '@/utils/color';

import { CheckinCard, type CheckinCardProps } from '../components/checkin-card';
import { CheckinDoneRow } from '../components/checkin-done-row';
import type { CheckinState } from '../types';

// O card do check-in de hoje e a linha do "Check-in feito", só com o estado
// que o servidor manda: o cabeçalho, a trilha num elemento só e o botão.

/** 20 h de São Paulo de 10 de novembro de 2026: faltam 4 horas para a meia-noite. */
const NOW = new Date('2026-11-10T23:00:00.000Z');

/** O estado do seed: 4 dias seguidos até ontem, o de hoje por fazer (o dia 5 do ciclo). */
function state(fields: Partial<CheckinState> = {}): CheckinState {
  return {
    enabled: true,
    checkedInToday: false,
    streak: 4,
    best: 4,
    cycle: [3, 3, 4, 4, 5, 6, 15],
    cycleDay: 5,
    todayPoints: 5,
    resetsAt: '2026-11-11T03:00:00.000Z',
    ...fields,
  };
}

function renderCard(props: Partial<CheckinCardProps> = {}) {
  const onCheckin = jest.fn();
  render(
    <CheckinCard
      state={state()}
      now={NOW}
      online
      pending={false}
      failure={null}
      onCheckin={onCheckin}
      {...props}
    />,
  );
  return onCheckin;
}

describe('card do check-in de hoje', () => {
  it('o selo, a sequência e o prazo são lidos juntos e abrem a seção como cabeçalho', () => {
    renderCard();
    expect(
      screen.getByRole('header', { name: 'Check-in diário. 4 dias seguidos. Termina em 4 horas.' }),
    ).toBeTruthy();
    expect(screen.getByText('Check-in diário')).toBeTruthy();
    expect(screen.getByText('4 dias seguidos')).toBeTruthy();
    expect(screen.getByText('Termina em 4 h')).toBeTruthy();
    // Um cabeçalho só por seção.
    expect(screen.getAllByRole('header')).toHaveLength(1);
  });

  it.each<[number, string]>([
    [0, 'Comece sua sequência'],
    [1, '1 dia seguido'],
  ])('com a sequência em %d, o topo diz "%s"', (streak, text) => {
    renderCard({ state: state({ streak, cycleDay: streak + 1, todayPoints: 3 }) });
    expect(screen.getByText(text)).toBeTruthy();
    expect(
      screen.getByRole('header', { name: `Check-in diário. ${text}. Termina em 4 horas.` }),
    ).toBeTruthy();
  });

  it('a trilha é um elemento só, lido como progresso, com os dias feitos, o de hoje e os seguintes', () => {
    renderCard();
    const track = screen.getByRole('progressbar', {
      name: 'Dia 5 de 7. O check-in de hoje vale 5 pontos. O dia 7 vale 15 pontos.',
    });
    expect(track).toHaveProp('accessibilityValue', { min: 0, max: 7, now: 4 });
    // Os dias feitos mostram o check, sem o valor; o de hoje e os seguintes, o "+N".
    expect(screen.queryByText('+3')).toBeNull();
    expect(screen.queryByText('+4')).toBeNull();
    expect(screen.getByText('+5')).toBeTruthy();
    expect(screen.getByText('+6')).toBeTruthy();
    expect(screen.getByText('+15')).toBeTruthy();
    expect(screen.getByText('Hoje')).toBeTruthy();
    expect(screen.getAllByText(/^Dia \d$/).map((node) => node.props.children)).toEqual([
      'Dia 1',
      'Dia 2',
      'Dia 3',
      'Dia 4',
      'Dia 6',
      'Dia 7',
    ]);
  });

  it('o dia feito vai em lima cheio com o check, o de hoje com o contorno lima e o "+N" em lima, e o seguinte apagado', () => {
    renderCard();

    const done = screen.getByTestId('checkin-cell-1');
    expect(done).toHaveStyle({ backgroundColor: colors.points, borderColor: colors.points });
    expect(within(done).UNSAFE_getByType(Check).props.color).toBe(colors.onPoints);
    expect(within(done).queryByText(/\+/)).toBeNull();
    expect(screen.getByText('Dia 1')).toHaveStyle({ color: colors.textMuted });

    const today = screen.getByTestId('checkin-cell-5');
    expect(today).toHaveStyle({
      borderWidth: borderWidths.strong,
      borderColor: colors.points,
      backgroundColor: withAlpha(colors.points, tints.faint.fill),
    });
    expect(within(today).getByText('+5')).toHaveStyle({ color: colors.points });
    expect(within(today).UNSAFE_queryByType(Check)).toBeNull();
    expect(screen.getByText('Hoje')).toHaveStyle({ color: colors.text });

    const upcoming = screen.getByTestId('checkin-cell-6');
    expect(upcoming).toHaveStyle({
      borderWidth: borderWidths.default,
      borderColor: colors.border,
      backgroundColor: colors.glass,
    });
    expect(within(upcoming).getByText('+6')).toHaveStyle({ color: colors.textSecondary });
    expect(within(upcoming).UNSAFE_queryByType(Check)).toBeNull();
    expect(screen.getByText('Dia 6')).toHaveStyle({ color: colors.textMuted });
  });

  it('desenha uma célula por valor do servidor: o ciclo não é fixo em 7 no app', () => {
    renderCard({ state: state({ cycle: [1, 2, 9], cycleDay: 1, todayPoints: 1, streak: 0 }) });
    expect(
      screen.getByRole('progressbar', {
        name: 'Dia 1 de 3. O check-in de hoje vale 1 ponto. O dia 3 vale 9 pontos.',
      }),
    ).toHaveProp('accessibilityValue', { min: 0, max: 3, now: 0 });
    expect(screen.getAllByText(/^(Hoje|Dia \d)$/)).toHaveLength(3);
    expect(screen.getAllByTestId(/^checkin-cell-\d+$/)).toHaveLength(3);
    expect(screen.getByText('+9')).toBeTruthy();
  });

  it('o maior valor de um dia do ciclo (999, o teto do servidor e do painel) vai na célula numa linha só, encolhendo para caber, e inteiro no rótulo da trilha e no botão', () => {
    renderCard({ state: state({ cycle: [3, 3, 4, 4, 999, 6, 999], todayPoints: 999 }) });

    // Na célula de hoje e numa das seguintes: três algarismos, nunca quatro.
    const today = within(screen.getByTestId('checkin-cell-5')).getByText('+999');
    const upcoming = within(screen.getByTestId('checkin-cell-7')).getByText('+999');
    expect(today).toHaveStyle({ color: colors.points });
    expect(upcoming).toHaveStyle({ color: colors.textSecondary });
    for (const value of [today, upcoming]) {
      expect(value).toHaveProp('numberOfLines', 1);
      expect(value).toHaveProp('adjustsFontSizeToFit', true);
      expect(value).toHaveProp('minimumFontScale', 0.7);
    }
    // O valor inteiro, por extenso, para o leitor de tela, e no botão.
    expect(
      screen.getByRole('progressbar', {
        name: 'Dia 5 de 7. O check-in de hoje vale 999 pontos. O dia 7 vale 999 pontos.',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fazer check-in, vale 999 pontos' })).toBeTruthy();
    expect(screen.getByText('Fazer check-in +999')).toBeTruthy();
  });

  it('o botão diz o valor de hoje, por extenso no rótulo, e o toque faz o check-in', () => {
    const onCheckin = renderCard();
    const button = screen.getByRole('button', { name: 'Fazer check-in, vale 5 pontos' });
    expect(button).toHaveProp('accessibilityHint', 'Marca o seu check-in de hoje');
    expect(screen.getByText('Fazer check-in +5')).toBeTruthy();
    expect(button).toBeEnabled();

    fireEvent.press(button);
    expect(onCheckin).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('checkin-message')).toBeNull();
  });
});

describe('o botão do check-in', () => {
  it('com o pedido indo, fica ocupado e não aceita outro toque', () => {
    const onCheckin = renderCard({ pending: true });
    const button = screen.getByRole('button', { name: 'Fazer check-in, vale 5 pontos' });
    expect(button).toBeDisabled();
    expect(button).toHaveProp('accessibilityState', expect.objectContaining({ busy: true }));
    fireEvent.press(button);
    expect(onCheckin).not.toHaveBeenCalled();
  });

  it('sem internet, fica desligado e diz o motivo na dica e embaixo dele', () => {
    const onCheckin = renderCard({ online: false });
    const button = screen.getByRole('button', { name: 'Fazer check-in, vale 5 pontos' });
    expect(button).toBeDisabled();
    expect(button).toHaveProp(
      'accessibilityHint',
      'Sem internet. Conecte-se para fazer o check-in.',
    );
    expect(screen.getByTestId('checkin-message')).toHaveTextContent(
      'Sem internet. Conecte-se para fazer o check-in.',
    );
    fireEvent.press(button);
    expect(onCheckin).not.toHaveBeenCalled();
  });

  it('a falha do toque aparece embaixo do botão, que segue ligado para tentar de novo', () => {
    const onCheckin = renderCard({ failure: 'checkin.error' });
    expect(screen.getByTestId('checkin-message')).toHaveTextContent(
      'Não deu para fazer o check-in. Tente de novo.',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Fazer check-in, vale 5 pontos' }));
    expect(onCheckin).toHaveBeenCalledTimes(1);
  });

  it('sem internet, o motivo do botão desligado vem antes da falha de antes', () => {
    renderCard({ online: false, failure: 'checkin.error' });
    expect(screen.getByTestId('checkin-message')).toHaveTextContent(
      'Sem internet. Conecte-se para fazer o check-in.',
    );
    expect(screen.queryByText('Não deu para fazer o check-in. Tente de novo.')).toBeNull();
  });

  it('com o check-in de hoje valendo 0 (o ciclo zerado), o botão sai sem o valor', () => {
    renderCard({ state: state({ cycle: [0, 0, 0, 0, 0, 0, 0], todayPoints: 0 }) });
    expect(screen.getByRole('button', { name: 'Fazer check-in' })).toBeTruthy();
    expect(screen.getByText('Fazer check-in')).toBeTruthy();
  });

  it('com o prazo vencido no relógio do aparelho, o topo sai sem o "Termina em"', () => {
    renderCard({ now: new Date('2026-11-11T03:05:00.000Z') });
    expect(screen.getByRole('header', { name: 'Check-in diário. 4 dias seguidos.' })).toBeTruthy();
    expect(screen.queryByText(/Termina em/)).toBeNull();
  });
});

describe('linha do check-in feito', () => {
  const done = state({ checkedInToday: true, streak: 5, best: 5 });

  it('é um elemento só, o cabeçalho da seção, com a sequência e o valor de amanhã', () => {
    render(<CheckinDoneRow state={done} />);
    const row = screen.getByRole('header', {
      name: 'Check-in feito. 5 dias seguidos. Amanhã vale 6 pontos.',
    });
    expect(row).toHaveProp('accessible', true);
    expect(screen.getByText('Check-in feito')).toBeTruthy();
    expect(screen.getByText('5 dias seguidos · Amanhã vale +6')).toBeTruthy();
    // O valor de amanhã, em lima; o resto da linha, apagado.
    expect(screen.getByText('+6')).toHaveStyle({ color: colors.points });
    // Sem toque: é estado, e não ação.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('no último dia do ciclo, amanhã vale o primeiro de novo', () => {
    render(<CheckinDoneRow state={state({ checkedInToday: true, streak: 7, cycleDay: 7 })} />);
    expect(
      screen.getByRole('header', {
        name: 'Check-in feito. 7 dias seguidos. Amanhã vale 3 pontos.',
      }),
    ).toBeTruthy();
    expect(screen.getByText('+3')).toBeTruthy();
  });
});
