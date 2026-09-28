import type { LucideIcon } from 'lucide-react-native';
import type { ColorValue } from 'react-native';

import { colors, layout } from '@/theme';

export interface IconProps {
  icon: LucideIcon;
  size?: number;
  /** Os navegadores entregam ColorValue; o app só usa cores em string. */
  color?: ColorValue;
  strokeWidth?: number;
  /** Preenche o desenho, como o coração curtido. */
  filled?: boolean;
}

/**
 * Ícones do lucide com o traço do design (1.8). Decorativos por padrão: quem
 * descreve a ação para o leitor de tela é o pressável em volta.
 */
export function Icon({
  icon: LucideComponent,
  size = layout.tabBarIconSize,
  color = colors.text,
  strokeWidth = 1.8,
  filled = false,
}: IconProps) {
  const stroke = color as string;
  return (
    <LucideComponent
      size={size}
      color={stroke}
      strokeWidth={strokeWidth}
      fill={filled ? stroke : 'none'}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    />
  );
}
