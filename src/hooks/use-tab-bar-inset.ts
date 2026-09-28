import { BottomTabBarHeightContext } from 'expo-router/js-tabs';
import { useContext } from 'react';

/**
 * Altura da tab bar customizada, que fica por cima do conteúdo. Fora das abas
 * devolve 0, então as telas compartilhadas podem chamar sem medo.
 */
export function useTabBarInset(): number {
  return useContext(BottomTabBarHeightContext) ?? 0;
}
