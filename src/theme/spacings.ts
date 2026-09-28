/**
 * O protótipo usa números ímpares (5, 7, 9, 11, 13). Em vez de forçar uma escala
 * de 4 em 4, os valores que se repetem ganham nome pelo papel.
 */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,

  gutter: 18,
  gutterOnboarding: 22,
  gutterAuth: 24,
  sectionTop: 24,
  sectionBottom: 12,
  listGap: 10,
  itemGap: 12,
  chipGap: 7,
  iconLabelGap: 5,
} as const;

/** Medidas fixas de peças do layout. */
export const layout = {
  tabBarContentHeight: 46,
  tabBarIconSize: 22,
  headerButtonSize: 36,
  // Alvo de toque mínimo (WCAG 2.2 e guias das lojas). Use hitSlop para chegar nele.
  minTouchTarget: 44,
} as const;
