import type { Href } from 'expo-router';
import { Gift, Target, UserPlus, type LucideIcon } from 'lucide-react-native';

import type { TranslationKey } from '@/i18n';

/** Rosa para ação, lima para o que vale pontos (regra de cor do protótipo). */
export type QuickActionTone = 'action' | 'points';

export interface QuickAction {
  id: string;
  labelKey: TranslationKey;
  icon: LucideIcon;
  tone: QuickActionTone;
  href: Href;
}

/**
 * Atalhos do "+" no meio da tab bar, aprovados em 2026-09-28. A aba Ranking
 * continua na barra; o "+" leva ao que gera pontos. Quando o painel admin
 * puder ligar, desligar e ordenar atalhos, esta lista vira o padrão e a API
 * diz quais aparecem.
 */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: 'invite',
    labelKey: 'quickActions.invite',
    icon: UserPlus,
    tone: 'action',
    href: '/convidar',
  },
  {
    id: 'missions',
    labelKey: 'quickActions.missions',
    icon: Target,
    tone: 'points',
    href: '/missoes',
  },
  {
    id: 'rewards',
    labelKey: 'quickActions.rewards',
    icon: Gift,
    tone: 'points',
    href: '/recompensas',
  },
];
