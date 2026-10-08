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

  // Título até a meta em listas (1g), texto do post (1b), rótulo até o campo.
  metaGap: 6,
  // Grades de 3 e 4 (top fãs, caixas, conquistas, pódio); título até subtítulo.
  tileGap: 9,
  // Grades de 2 e carrossel (1b 1h); padding do card da central.
  gridGap: 11,
  // Vão interno da linha da agenda (1m).
  rowGap: 13,
  // Padding de card de missão (1g), destaque da agenda, linha de post (1b).
  cardPadding: 14,
  // Título de página até a linha de chips (1f 1m).
  titleToChips: 15,
  // Título até o primeiro card (1g 1h), chips até o destaque (1m).
  blockGap: 18,
  // "Esta semana" (1g), card de pontos (1e), vão das abas (1d).
  sectionTopTight: 20,
  // Sobrelinha de seção: "Hoje", "Ao seu alcance" (1g 1h).
  sectionLabelTop: 22,
  // Texto de apoio até o primeiro botão (1k e formulários de conta).
  authLeadGap: 26,
} as const;

/** Medidas fixas de peças do layout. */
export const layout = {
  tabBarContentHeight: 46,
  tabBarIconSize: 22,
  headerButtonSize: 36,
  // Alvo de toque mínimo (WCAG 2.2 e guias das lojas). No Fabric do iOS o
  // hitSlop fora da área do pai não recebe toque: cresça o próprio pressável e
  // desenhe o visual menor dentro dele.
  minTouchTarget: 44,

  // Altura desenhada do `Button`. De `mdCompact` para baixo o desenho fica
  // menor que o alvo de 44, e o pressável cresce por fora dele.
  buttonHeight: {
    lg: 50,
    md: 44,
    // Botões do card da missão do dia (1b).
    mdCompact: 36,
    // Botões do destaque da agenda (1m): "Eu vou" e "Chamar amigos".
    sm: 30,
    // "Eu vou" das linhas (1m).
    xs: 29,
  },
  // Campo de formulário (`TextInput`).
  fieldHeight: 50,

  coverButtonSize: 38,
  // Somadas a `insets.top` (1d).
  coverHeight: 234,
  compactHeaderHeight: 38,
  iconTile: 38,
  checkBadge: 26,
  // O selo da câmera no canto da foto grande (tela "Editar perfil").
  photoBadge: 32,
  selectMark: 24,
  // Trilho e polegar do `Switch` (a conta privada da tela "Editar perfil"),
  // nas medidas do switch do iOS; o polegar fica a 2 da borda do trilho.
  switch: { width: 51, height: 31, thumb: 27 },
  progressBar: { sm: 7, md: 8 },
  stepBar: 3,
  // minWidth da coluna do selo de data (1m).
  dateColumn: 50,
  // Divisória vertical entre a data e o título na linha da agenda (1m).
  dateDivider: 38,
  dateBadge: { width: 44, height: 50 },
  eventHeroMinHeight: 186,
  rewardHeroMinHeight: 196,
  rewardTileHeight: 74,
  artistTileHeight: 154,
  postThumb: 94,
  centralCard: { width: 112, imageWidth: 88, imageHeight: 66 },
  // Largura sobre altura.
  gridCellAspect: 118.7 / 104,
  mediaAspectDefault: 402 / 236,
  composerMinHeight: 40,
  // Medida do círculo e tamanho da fonte das iniciais (Sora 800).
  avatar: {
    // Pilha da 1l.
    xs: { size: 28, initials: 9 },
    // Top fãs (1d), centrais (1e), comentários.
    sm: { size: 34, initials: 11 },
    // Lista e card "Você" (1f).
    md: { size: 36, initials: 12 },
    // Autor do post.
    lg: { size: 38, initials: 13 },
    // Header da 1b: miolo de 36 dentro do anel de 2.
    xl: { size: 40, initials: 13 },
    // 2º e 3º do pódio (1f).
    podium: { size: 52, initials: 16 },
    // 1º do pódio, com anel lima de 2,5.
    podiumFirst: { size: 62, initials: 19 },
    // 1e, dentro do ProgressRing de 96.
    hero: { size: 84, initials: 28 },
    // A foto grande da tela "Editar perfil" e do perfil público (seção 28).
    profile: { size: 104, initials: 34 },
  },
  // Espessura do anel do avatar: 2 no gradiente da 1b e no rosa do próprio
  // fã, 2,5 no lima do 1º do pódio (1f), que fica com miolo de 57.
  avatarRing: { brand: 2, points: 2.5, self: 2 },
  // Quanto cada avatar da pilha (1l) entra sobre o anterior.
  avatarStackOverlap: 9,
} as const;

export type AvatarSize = keyof typeof layout.avatar;
