import { render, screen } from '@testing-library/react-native';
import { StyleSheet, TextInput } from 'react-native';

import { offstage, StepField } from '../components/step-field';

const LABEL = 'Campo da pergunta';

function field(shown: boolean) {
  return (
    <StepField shown={shown}>
      <TextInput accessibilityLabel={LABEL} defaultValue="camila" />
    </StepField>
  );
}

/** O campo, à vista ou guardado. */
const input = () => screen.getByLabelText(LABEL, { includeHiddenElements: true });

/** A caixa (em host) logo em volta do campo: a que o `StepField` desenha. */
function box() {
  let current = input().parent;
  while (current && typeof current.type !== 'string') current = current.parent;
  if (!current) throw new Error('o campo devia estar dentro de uma caixa');
  return current;
}

describe('o que fica montado fora da vista', () => {
  it('fora da vista: sem toque e fora do leitor de tela, com tudo o que há dentro', () => {
    expect(offstage(true)).toEqual({
      pointerEvents: 'none',
      accessible: false,
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    });
  });

  it('à vista: com toque e no leitor de tela, sem virar um foco só', () => {
    expect(offstage(false)).toEqual({
      pointerEvents: 'auto',
      accessible: false,
      accessibilityElementsHidden: false,
      importantForAccessibility: 'auto',
    });
  });
});

describe('campo de uma pergunta da entrada', () => {
  it('à vista: no fluxo, com toque e no leitor de tela, sem estilo nenhum', () => {
    render(field(true));

    expect(screen.getByLabelText(LABEL)).toBeTruthy();
    expect(box().props.style).toBeUndefined();
    expect(box().props).toMatchObject({
      pointerEvents: 'auto',
      accessibilityElementsHidden: false,
      importantForAccessibility: 'auto',
    });
  });

  it('guardado: fora do fluxo, sem desenho, sem toque e fora do leitor de tela', () => {
    render(field(false));

    // O leitor de tela não o acha; ele segue montado.
    expect(screen.queryByLabelText(LABEL)).toBeNull();
    expect(input()).toBeTruthy();
    expect(box()).toHaveStyle({ position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 });
    // Opacidade zero, e não `display: 'none'`, que tiraria o foco do campo
    // antes de o seguinte recebê-lo.
    expect(StyleSheet.flatten(box().props.style).display).toBeUndefined();
    expect(box().props).toMatchObject({
      pointerEvents: 'none',
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    });
  });

  it('a caixa existe de verdade nos dois estados: achatada num e não no outro, o campo com o foco trocaria de pai', () => {
    const view = render(field(true));
    expect(box()).toHaveProp('collapsable', false);

    view.rerender(field(false));
    expect(box()).toHaveProp('collapsable', false);
  });

  it('a pergunta que sai não desmonta o campo: é o mesmo, com o que foi digitado, na ida e na volta', () => {
    const view = render(field(true));
    const mounted = input();

    view.rerender(field(false));
    // Comparado por fora do `expect`, que numa falha imprimiria a árvore inteira.
    expect(input() === mounted).toBe(true);
    expect(input()).toHaveProp('defaultValue', 'camila');

    view.rerender(field(true));
    expect(input() === mounted).toBe(true);
    expect(screen.getByLabelText(LABEL)).toBeTruthy();
  });
});
