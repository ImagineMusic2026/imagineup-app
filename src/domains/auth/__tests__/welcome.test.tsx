import { act, render, screen, within } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import { Polygon } from 'react-native-svg';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { createStackEntrance, type StackEntranceTrigger } from '@/hooks/use-stack-fade';
import { t } from '@/i18n';
import { motion } from '@/theme';

import { RiseIn } from '../components/rise-in';
import { AuthEntranceContext } from '../hooks/use-auth-entrance';
import { WelcomeScreen } from '../views/welcome';

// A 1k só pergunta se o Firebase está configurado.
jest.mock('@/firebase', () => ({ isFirebaseConfigured: true }));

const metrics = {
  frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
};

let entrance: StackEntranceTrigger;

beforeEach(() => {
  entrance = createStackEntrance();
});

function welcome() {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <AuthEntranceContext value={entrance}>
        <WelcomeScreen />
      </AuthEntranceContext>
    </SafeAreaProvider>
  );
}

/** Opacidade de cada barra da marca ao lado do título, no primeiro quadro. */
function barsOpacity(): number[] {
  return screen.root
    .findAll((node) => node.type === Polygon)
    .map((node) => {
      const animated = node.props.animatedProps as { fillOpacity: number } | undefined;
      return animated ? animated.fillOpacity : (node.props.fillOpacity as number);
    });
}

afterEach(() => jest.restoreAllMocks());

describe('abertura (1k)', () => {
  it('os blocos entram nesta ordem: título, texto, criar conta, já tenho conta e termos', () => {
    render(welcome());
    const blocks = screen.UNSAFE_getAllByType(RiseIn);
    expect(blocks.map((block) => block.props.order)).toEqual([0, 1, 2, 3, 4]);

    const [title, lead, create, signIn] = blocks;
    expect(within(title!).getByRole('header', { name: t('auth.welcome.title') })).toBeTruthy();
    expect(within(lead!).getByText(t('auth.welcome.lead'))).toBeTruthy();
    expect(
      within(create!).getByRole('button', { name: t('auth.welcome.createAccount') }),
    ).toBeTruthy();
    expect(
      within(signIn!).getByRole('button', { name: t('auth.welcome.haveAccount') }),
    ).toBeTruthy();
  });

  it('tudo espera o fade da pilha: antes dele, nada começa, e as barras nascem apagadas', () => {
    const delay = jest.spyOn(Reanimated, 'withDelay');
    render(welcome());
    expect(delay).not.toHaveBeenCalled();
    expect(barsOpacity()).toEqual([0, 0, 0]);
  });

  it('no fade da pilha, os blocos sobem em sequência e as barras acendem enquanto o título sobe', () => {
    render(welcome());
    const delay = jest.spyOn(Reanimated, 'withDelay');
    act(() => entrance.enter());

    // 60 ms entre os blocos; as barras, 80 ms entre elas, a partir de 150 ms.
    const bars = motion.duration.fast;
    const byTime = (a: number, b: number) => a - b;
    expect(delay.mock.calls.map(([wait]) => wait).sort(byTime)).toEqual(
      [0, 60, 120, 180, 240, bars, bars + 80, bars + 160].sort(byTime),
    );
  });
});
