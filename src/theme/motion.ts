import { Easing, type WithSpringConfig } from 'react-native-reanimated';

/**
 * Movimento fluido e discreto: curvas suaves, nada de troca seca, e sempre
 * respeitando "reduzir movimento". O AppProviders espelha a opção do sistema no
 * Reanimated (inclusive quando ela muda com o app aberto), então as animações
 * seguem sozinhas; não passe `ReduceMotion.Never` numa animação. As exceções
 * são a volta ao soltar do deslize entre as abas (`tab-bar/swipe.tsx`,
 * decisão do dono de 03/11/2026), que continua o gesto do fã, e a frase em
 * laço da abertura (`domains/auth/components/tagline.tsx`, decisão do dono de
 * 17/11/2026).
 */
export const motion = {
  duration: {
    fast: 150,
    base: 250,
    slow: 400,
    counter: 700,
    // Movimento de fundo, que assenta devagar por trás do resto (a foto da 1k).
    settle: 1200,
  },
  // Entrada em sequência (1k): cada bloco sobe um pouco, um depois do outro.
  stagger: {
    rise: 12,
    step: 60,
  },
  // Bloco grande que abre empurrando a tela (o card do check-in da Início, o
  // `RevealExpandable`). Com o `base` e o `out`, três quartos do caminho saíam
  // nos primeiros 50 ms, e o dono viu o card "abrir na hora" (25/11/2026): a
  // altura desce no `standard`, devagar o bastante para se ver, e sobe mais
  // rápido no `inOut`; o conteúdo entra em fade, descendo `rise`, um pouco
  // depois de a altura começar, e sai antes de ela fechar.
  reveal: {
    open: 420,
    close: 300,
    contentDelay: 80,
    contentIn: 280,
    contentOut: 160,
    rise: 12,
    // Aberto, a troca de altura do conteúdo (o botão que vira o pé do "feito").
    resize: 250,
  },
  // A abertura da marca (`LaunchSplash`), por cima da splash nativa: a espera
  // do fade dela antes de o símbolo se mexer (o mesmo `duration` do
  // `SplashScreen.setOptions` no `_layout` raiz), a batida do símbolo e a
  // saída para a primeira tela, no tempo do fade da splash nativa.
  launch: {
    handoff: 300,
    beat: 1150,
    fade: 300,
  },
  easing: {
    out: Easing.bezier(0.23, 1, 0.32, 1),
    inOut: Easing.bezier(0.65, 0, 0.35, 1),
    // Sai devagar e assenta macio: metade do caminho em 20% do tempo, e não em 5%.
    standard: Easing.bezier(0.2, 0, 0, 1),
  },
  spring: {
    gentle: { damping: 18, stiffness: 220, mass: 0.7 },
    snappy: { damping: 16, stiffness: 320, mass: 0.6 },
  } satisfies Record<string, WithSpringConfig>,
  pressScale: 0.97,
} as const;
