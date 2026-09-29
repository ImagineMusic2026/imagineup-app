import { onlineManager } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors } from '@/theme';

import { Screen } from '..';

const insets = { top: 47, bottom: 34, left: 0, right: 0 };
const metrics = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets };

function renderScreen(ui: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

/** Caixa (em host) mais próxima acima do nó. */
function hostParent(node: ReturnType<typeof screen.getByText>) {
  let current = node.parent;
  while (current && typeof current.type !== 'string') current = current.parent;
  return current;
}

/** Raiz da casca: a caixa com o fundo da tela. */
function shell() {
  return screen.root.find(
    (node) =>
      typeof node.type === 'string' &&
      StyleSheet.flatten(node.props.style)?.backgroundColor === colors.background,
  );
}

/** Caixas absolutas (em host). */
function absoluteBoxes() {
  return screen.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      StyleSheet.flatten(node.props.style)?.position === 'absolute',
  );
}

function goOffline() {
  act(() => onlineManager.setOnline(false));
}

afterEach(() => {
  act(() => onlineManager.setOnline(true));
});

describe('Screen', () => {
  it('o fundo fica preso ao y 0 da tela, atrás do conteúdo e sem toque', () => {
    renderScreen(
      <Screen backdrop={<View testID="glow" />}>
        <Text>Conteúdo</Text>
      </Screen>,
    );
    const layer = hostParent(screen.getByTestId('glow'))!;
    expect(layer).toHaveProp('pointerEvents', 'none');
    expect(StyleSheet.flatten(layer.props.style)).toMatchObject({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    });
    // Desenhado antes do conteúdo, então fica por baixo dele.
    const order = screen.root.findAll(
      (node) => node.props.testID === 'glow' || node.props.children === 'Conteúdo',
      { deep: true },
    );
    expect(order[0]?.props.testID).toBe('glow');
  });

  it('com a área segura, o aviso de offline entra no fluxo abaixo da barra de status', () => {
    goOffline();
    renderScreen(
      <Screen>
        <Text>Conteúdo</Text>
      </Screen>,
    );
    expect(shell()).toHaveStyle({ paddingTop: insets.top });
    expect(screen.getByText(t('offline.banner'))).toBeTruthy();
    expect(absoluteBoxes()).toHaveLength(0);
  });

  it('sem a área segura, o aviso flutua abaixo da barra de status, sem empurrar a foto nem pegar o toque', () => {
    goOffline();
    renderScreen(
      <Screen safeTop={false}>
        <Text>Capa</Text>
      </Screen>,
    );
    expect(shell()).toHaveStyle({ paddingTop: 0 });
    const floating = absoluteBoxes();
    expect(floating).toHaveLength(1);
    expect(floating[0]).toHaveStyle({ top: insets.top });
    expect(floating[0]).toHaveProp('pointerEvents', 'none');
  });

  it('a tela escolhe onde o aviso flutua', () => {
    goOffline();
    renderScreen(
      <Screen safeTop={false} bannerTop={120}>
        <Text>Capa</Text>
      </Screen>,
    );
    const [floating] = absoluteBoxes();
    expect(floating).toHaveStyle({ top: 120 });
    expect(floating?.findByType(Text)).toBeTruthy();
  });

  it('transparente, deixa aparecer o fundo que o navegador desenha atrás da pilha', () => {
    renderScreen(
      <Screen transparent>
        <Text>Formulário</Text>
      </Screen>,
    );
    const opaque = screen.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        StyleSheet.flatten(node.props.style)?.backgroundColor === colors.background,
    );
    expect(opaque).toHaveLength(0);
    const root = screen.root.find(
      (node) =>
        typeof node.type === 'string' &&
        StyleSheet.flatten(node.props.style)?.backgroundColor === colors.transparent,
    );
    expect(root).toHaveStyle({ flex: 1, paddingTop: insets.top });
  });

  it('no iOS, a rolagem ganha o espaço do teclado e rola até o campo focado', () => {
    renderScreen(
      <Screen scroll>
        <Text>Formulário</Text>
      </Screen>,
    );
    expect(screen.UNSAFE_getByType(ScrollView).props).toMatchObject({
      automaticallyAdjustKeyboardInsets: true,
      keyboardDismissMode: 'interactive',
    });
    // Os dois juntos somariam o espaço do teclado.
    expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.enabled).toBe(false);
  });

  it('online, nenhum aviso aparece', () => {
    renderScreen(
      <Screen safeTop={false}>
        <Text>Capa</Text>
      </Screen>,
    );
    expect(screen.queryByText(t('offline.banner'))).toBeNull();
  });
});
