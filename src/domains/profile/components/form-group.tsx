import { Children, Fragment, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { borderWidths, colors } from '@/theme';

export interface FormGroupProps {
  children: ReactNode;
  testID?: string;
}

/**
 * Um grupo da tela "Editar perfil" ("Informações básicas", "Detalhes", "Redes
 * sociais"): um card só, sem padding, com as peças uma embaixo da outra e uma
 * divisória entre elas. Os campos dentro dele são `bare` (sem caixa própria).
 * O card não é acessível nem tocável: cada campo e cada linha tem o seu foco.
 */
export function FormGroup({ children, testID }: FormGroupProps) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <Card padding="none" style={styles.card} testID={testID}>
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 ? <View style={styles.divider} /> : null}
          {item}
        </Fragment>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  // A linha de foco do último campo não passa do canto arredondado.
  card: {
    overflow: 'hidden',
  },
  divider: {
    height: borderWidths.default,
    backgroundColor: colors.divider,
  },
});
