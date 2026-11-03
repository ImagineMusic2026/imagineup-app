import { toTabItems } from '../tab-items';

type NavigatorProps = Parameters<typeof toTabItems>[0];

const routes = [
  { key: 'inicio-1', name: '(inicio)' },
  { key: 'explorar-1', name: '(explorar)' },
  { key: 'ranking-1', name: '(ranking)' },
];

function navigatorAt(index: number) {
  const navigation = {
    emit: jest.fn(() => ({ defaultPrevented: false })),
    navigate: jest.fn(),
  };
  const descriptors = Object.fromEntries(
    routes.map((route) => [route.key, { options: { title: route.name } }]),
  );
  const props = {
    state: { index, routes },
    descriptors,
    navigation,
  } as unknown as NavigatorProps;
  return { props, navigation };
}

describe('toTabItems', () => {
  it('sem o arraste, destaca a aba em foco no navegador', () => {
    const { props } = navigatorAt(1);
    expect(toTabItems(props).map((item) => item.focused)).toEqual([false, true, false]);
  });

  it('com a página do arraste assentada, destaca a aba de destino antes do navegador', () => {
    const { props } = navigatorAt(0);
    expect(toTabItems(props, 1).map((item) => item.focused)).toEqual([false, true, false]);
  });

  it('o toque segue o foco do navegador, e não o destaque do arraste', () => {
    const { props, navigation } = navigatorAt(0);
    const [inicio, explorar] = toTabItems(props, 1);

    // A Início ainda é a aba em foco: tocar nela não troca de aba.
    inicio?.onPress();
    expect(navigation.navigate).not.toHaveBeenCalled();

    explorar?.onPress();
    expect(navigation.navigate).toHaveBeenCalledWith('(explorar)', undefined);
  });
});
