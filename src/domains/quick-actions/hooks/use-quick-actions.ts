import { router } from 'expo-router';
import { useMemo } from 'react';

import type { CenterMenuAction } from '@/components/tab-bar';
import { t } from '@/i18n';
import { colors } from '@/theme';

import { QUICK_ACTIONS } from '../actions';

/**
 * Os atalhos do "+" prontos para a tab bar desenhar.
 *
 * Missões e Recompensas moram na pilha da Ranking: o `navigate` com a âncora
 * monta essa pilha com a 1f embaixo quando o fã vem de outra aba (o `push`
 * criava a pilha só com o destino, o voltar caía no Início e a 1f ficava fora
 * de alcance), e não empilha de novo a tela que já está aberta.
 */
export function useQuickActions(): CenterMenuAction[] {
  return useMemo(
    () =>
      QUICK_ACTIONS.map((action) => ({
        key: action.id,
        label: t(action.labelKey),
        icon: action.icon,
        color: action.tone === 'points' ? colors.points : colors.accent,
        onPress: () => router.navigate(action.href, { withAnchor: true }),
      })),
    [],
  );
}
