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
  numberPodiumFirst: {
    fontFamily: fonts.soraExtraBold,
    fontSize: 24,
    lineHeight: 27,
  },
  numberDate: { fontFamily: fonts.soraExtraBold, fontSize: 19, lineHeight: 21 },
  numberStat: { fontFamily: fonts.soraExtraBold, fontSize: 16, lineHeight: 19 },
  numberSmall: { fontFamily: fonts.soraExtraBold, fontSize: 15, lineHeight: 18 },
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
  chipSmall: { fontFamily: fonts.soraExtraBold, fontSize: 10.5, lineHeight: 13 },
  badge: {
    fontFamily: fonts.soraExtraBold,
    fontSize: 10.5,
    lineHeight: 13,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  badgeSmall: {
    fontFamily: fonts.soraExtraBold,
    fontSize: 9.5,
    lineHeight: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  pointsTiny: { fontFamily: fonts.soraBold, fontSize: 10, lineHeight: 12 },
  bodyLead: { fontFamily: fonts.manropeMedium, fontSize: 15, lineHeight: 22 },
  body: { fontFamily: fonts.manropeRegular, fontSize: 13, lineHeight: 19.5 },
  bodySmall: { fontFamily: fonts.manropeRegular, fontSize: 12.5, lineHeight: 18 },
  bodyXs: { fontFamily: fonts.manropeRegular, fontSize: 11.5, lineHeight: 16.5 },
  input: { fontFamily: fonts.manropeMedium, fontSize: 15, lineHeight: 20 },
  inputCompact: { fontFamily: fonts.manropeMedium, fontSize: 13.5, lineHeight: 18 },
  buttonAlt: { fontFamily: fonts.manropeBold, fontSize: 14, lineHeight: 17 },
  label: { fontFamily: fonts.manropeBold, fontSize: 13, lineHeight: 16 },
  tabItem: { fontFamily: fonts.manropeSemiBold, fontSize: 12.5, lineHeight: 15 },
  labelCompact: { fontFamily: fonts.manropeBold, fontSize: 12, lineHeight: 15 },
  labelSmall: { fontFamily: fonts.manropeSemiBold, fontSize: 11.5, lineHeight: 14 },
  caption: { fontFamily: fonts.manropeMedium, fontSize: 11.5, lineHeight: 15 },
  buttonXs: { fontFamily: fonts.manropeBold, fontSize: 11, lineHeight: 14 },
  metaSmall: { fontFamily: fonts.manropeMedium, fontSize: 10.5, lineHeight: 13 },
  micro: { fontFamily: fonts.manropeSemiBold, fontSize: 10, lineHeight: 12 },
  statLabel: {
    fontFamily: fonts.manropeSemiBold,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  labelTiny: { fontFamily: fonts.manropeBold, fontSize: 10, lineHeight: 12 },
  // Rótulo das caixas de número da 1e ("links criados"): o 9,5 do protótipo,
  // em minúsculas e com a entrelinha 1,3 dele, abaixo do mínimo recomendado
  // como a tab bar (pergunta aberta com a cliente).
  statCaption: { fontFamily: fonts.manropeSemiBold, fontSize: 9.5, lineHeight: 12.5 },
  overline: {
    fontFamily: fonts.manropeBold,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  // Sobre o lima (missão do dia da 1b): o peso 800 segura o contraste do texto a .6.
  overlineStrong: {
    fontFamily: fonts.manropeExtraBold,
    fontSize: 9.5,
    lineHeight: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  // Rótulo sobre a miniatura do post de show (1b), como o "PLAYLIST" do protótipo.
  thumbLabel: {
    fontFamily: fonts.manropeExtraBold,
    fontSize: 9.5,
    lineHeight: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  dateMonth: {
    fontFamily: fonts.manropeBold,
    fontSize: 9,
    lineHeight: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  // O "/20" ao lado do número no anel da temporada (1g): sem o espaçamento do mês.
  counterSuffix: { fontFamily: fonts.manropeBold, fontSize: 9, lineHeight: 11 },
  // 8,5 fica abaixo do mínimo recomendado, como a tab bar: rótulo das conquistas
  // (1e) e título do 1º no pódio (1f). Pergunta aberta com a cliente.
  microLabel: { fontFamily: fonts.manropeBold, fontSize: 8.5, lineHeight: 11 },
  // O título do 1º no pódio (1f): o `microLabel` em caixa alta, com o espaçamento do protótipo.
  podiumTitle: {
    fontFamily: fonts.manropeBold,
    fontSize: 8.5,
    lineHeight: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  // 9,5 px vem do protótipo e fica abaixo do mínimo recomendado. Revisar com a
  // cliente antes de travar a tab bar. Entrelinha colada no corpo, como a
  // entrelinha 1 do protótipo, para a barra ficar na altura do desenho: a
  // Manrope não corta descendente como a Sora.
  tabLabel: { fontFamily: fonts.manropeSemiBold, fontSize: 9.5, lineHeight: 10 },
  tabLabelActive: { fontFamily: fonts.manropeBold, fontSize: 9.5, lineHeight: 10 },
} as const satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;

/**
 * Fonte do sistema a partir da qual as linhas deixam de cortar texto: o que
 * fica à direita do título desce para baixo dele, e os títulos quebram
 * inteiros. É a maior fonte do Android sem a ampliação de acessibilidade
 * (1,3); daí para cima, o que fica ao lado deixaria menos de uma palavra por
 * linha para o título num aparelho de 360. Usada pela agenda (1m) e pela
 * tela "Editar perfil" (o valor do gênero desce para baixo do título).
 */
export const LARGE_TEXT_SCALE = 1.3;
