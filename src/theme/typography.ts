import type { TextStyle } from 'react-native';

/**
 * Sora para títulos e números, Manrope para interface e corpo. Cada peso é uma
 * família própria: o Android não sintetiza peso em fonte customizada, então
 * nunca use `fontWeight` junto com estas famílias.
 */
export const fonts = {
  soraBold: 'Sora_700Bold',
  soraExtraBold: 'Sora_800ExtraBold',
  manropeRegular: 'Manrope_400Regular',
  manropeMedium: 'Manrope_500Medium',
  manropeSemiBold: 'Manrope_600SemiBold',
  manropeBold: 'Manrope_700Bold',
  manropeExtraBold: 'Manrope_800ExtraBold',
} as const;

/**
 * Papéis tipográficos do protótipo. O `lineHeight` fica em torno de 1,1 vez o
 * tamanho mesmo onde o design usa 1 ou 0,94, porque a Sora corta descendentes
 * no Android com entrelinha menor.
 */
export const typography = {
  displayXl: { fontFamily: fonts.soraExtraBold, fontSize: 42, lineHeight: 46, letterSpacing: -2 },
  displayLg: { fontFamily: fonts.soraExtraBold, fontSize: 38, lineHeight: 42, letterSpacing: -1.8 },
  numberHero: {
    fontFamily: fonts.soraExtraBold,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -1.4,
  },
  titleOnboarding: {
    fontFamily: fonts.soraExtraBold,
    fontSize: 27,
    lineHeight: 30,
    letterSpacing: -1.1,
  },
  titlePage: { fontFamily: fonts.soraExtraBold, fontSize: 26, lineHeight: 29, letterSpacing: -1 },
  titleCard: { fontFamily: fonts.soraExtraBold, fontSize: 21, lineHeight: 24, letterSpacing: -0.7 },
  titleGreeting: {
    fontFamily: fonts.soraExtraBold,
    fontSize: 20,
    lineHeight: 23,
    letterSpacing: -0.6,
  },
  titleEvent: {
    fontFamily: fonts.soraExtraBold,
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: -0.5,
  },
  titleHeader: {
    fontFamily: fonts.soraExtraBold,
    fontSize: 17,
    lineHeight: 20,
    letterSpacing: -0.5,
  },
  headingSection: {
    fontFamily: fonts.soraExtraBold,
    fontSize: 14,
    lineHeight: 17,
    letterSpacing: -0.3,
  },
  button: { fontFamily: fonts.soraExtraBold, fontSize: 14, lineHeight: 17 },
  buttonSmall: { fontFamily: fonts.soraExtraBold, fontSize: 13, lineHeight: 16 },
  points: { fontFamily: fonts.soraExtraBold, fontSize: 13, lineHeight: 16 },
  chip: { fontFamily: fonts.soraExtraBold, fontSize: 11.5, lineHeight: 14 },
  bodyLead: { fontFamily: fonts.manropeMedium, fontSize: 15, lineHeight: 22 },
  body: { fontFamily: fonts.manropeRegular, fontSize: 13, lineHeight: 19.5 },
  bodySmall: { fontFamily: fonts.manropeRegular, fontSize: 12.5, lineHeight: 18 },
  label: { fontFamily: fonts.manropeBold, fontSize: 13, lineHeight: 16 },
  labelSmall: { fontFamily: fonts.manropeSemiBold, fontSize: 11.5, lineHeight: 14 },
  caption: { fontFamily: fonts.manropeMedium, fontSize: 11.5, lineHeight: 15 },
  overline: {
    fontFamily: fonts.manropeBold,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  // 9,5 px vem do protótipo e fica abaixo do mínimo recomendado. Revisar com a
  // cliente antes de travar a tab bar.
  tabLabel: { fontFamily: fonts.manropeSemiBold, fontSize: 9.5, lineHeight: 12 },
  tabLabelActive: { fontFamily: fonts.manropeBold, fontSize: 9.5, lineHeight: 12 },
} as const satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;
