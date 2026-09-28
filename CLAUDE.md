# ImagineUP App

App iOS e Android de fãs dos artistas da Imagine Music: central de fãs por artista, mural com posts dos artistas (o fã curte e comenta), gamificação (toda interação vale pontos, missões, ranking por temporada, loja de recompensas) e agenda de shows. O fã ganha pontos por trazer gente nova pelo link de convite com atribuição.

Contrato assinado com a IMAGINE MUSIC LTDA, 10 entregas mensais. O painel admin web e o site público moram em outro repositório (`Projetos/imagineup`, repo `ImagineMusic2026/imagineup-painel`). Tarefas no Notion (página ImagineUP, banco Tarefas, refs `UP-n`), nunca no Linear.

## Antes de mexer

- Leia `vault/Welcome.md` e `vault/ImagineUP/` na raiz de `Projetos` (regra do workspace).
- O protótipo é `Projetos/imagineup/ImagineUP.dc.html`. Os códigos de tela (1b, 1d, 1e...) usados nos comentários vêm dele.
- A Expo muda API a cada SDK. Antes de escrever código que toca Expo, EAS ou React Native, confira a doc da versão instalada: `https://docs.expo.dev/versions/v57.0.0/` e `https://docs.expo.dev/llms.txt`. Não confie em memória.
- Instale dependência sempre com `npx expo install <pacote>`: o npm puro puxa majors incompatíveis (gesture-handler 3, async-storage 3, reanimated 4.7, RN 0.87).

## Escopo do contrato

Fora do contrato, mesmo que apareçam no protótipo: notificações push e in-app, montador de playlists, post criado por fã (o fã só curte e comenta), pagamentos, integrações com Spotify, Meta, TikTok, YouTube e OneRPM, ranking de amigos, filtro "perto de mim" e "ao vivo". Tela do protótipo que não está no Anexo I do contrato é aditivo: pergunte antes de construir.

Pontos, níveis, missões e resgates são decididos **no servidor**. O app nunca grava saldo, e toda ação que vale ponto manda chave de idempotência.

## Stack (Expo SDK 57)

| Área                 | Escolha                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| Base                 | Expo 57, React Native 0.86.3, React 19.2, TypeScript 6 (strict), Nova Arquitetura, React Compiler ligado |
| Navegação            | Expo Router 57, abas JS de `expo-router/js-tabs` com tab bar própria                                     |
| Estilo               | `StyleSheet` puro com os tokens de `src/theme`. Nenhuma lib de estilo                                    |
| Dados do servidor    | TanStack Query 5 com axios, cache persistido no aparelho                                                 |
| Estado do cliente    | Zustand 5                                                                                                |
| Formulários          | zod 4 com react-hook-form e `@hookform/resolvers`                                                        |
| Autenticação e banco | Firebase, SDK JS 12 (projeto `imagine-up`, Firestore em southamerica-east1)                              |
| Animação             | Reanimated 4 (com react-native-worklets) e Skia 2                                                        |
| Listas               | `@shopify/flash-list` 2                                                                                  |
| Ícones               | `lucide-react-native`                                                                                    |
| Datas                | date-fns 4 em pt-BR                                                                                      |
| Haptics              | `expo-haptics` atrás de `src/services/haptics`                                                           |
| Build e OTA          | EAS Build e EAS Update                                                                                   |
| Testes               | jest-expo com Testing Library 13                                                                         |

## Decisões e o porquê

1. **Expo Router, não React Navigation.** O desenho da tab bar e dos headers não desempata: o Expo Router 57 traz o mesmo código do React Navigation por dentro, e a prop `tabBar` é a mesma. O que decidiu: o convite com atribuição (mês 3) sai da própria árvore de arquivos e do `+native-intent`; `Stack.Protected` separa login, onboarding e app; rotas tipadas; `renderRouter` testa deep link no Jest; e é o caminho oficial da SDK. Desde a SDK 56 não dá para importar `@react-navigation/*` com o Expo Router (o lint bloqueia).
2. **SDK JS do Firebase, não `@react-native-firebase`.** Sem conta Apple e sem Mac, o único jeito de testar no iPhone é o Expo Go, e o RNFB não roda nele. O custo: o Firestore do SDK JS só tem cache em memória no React Native, então o offline vem do React Query persistido, e não há Crashlytics, Analytics nem App Check nativo. Reavaliar quando a conta Apple sair.
3. **AsyncStorage, não MMKV.** Mesmo motivo (Expo Go). A troca fica contida em `src/services/storage`, no persister do Query e no store de preferências.
4. **Estrutura do Delirium adaptada ao Expo Router.** O projeto `clubdelirium/mobile` organiza por `src/domains/<domínio>/{views,components,...}`. Aqui o mesmo desenho vale, com uma diferença: as rotas moram em `src/app`, como arquivos finos que só reexportam a view do domínio.
5. **Abas JS com tab bar própria, não NativeTabs.** As NativeTabs usam a barra do sistema e não aceitam o botão central nem o fundo em gradiente com blur do protótipo.

## Estrutura

```
src/
├── app/                  # rotas do Expo Router (só arquivos finos, até 3 linhas)
│   ├── _layout.tsx       # fontes, splash, providers, Stack raiz com Stack.Protected
│   ├── +native-intent.ts # reescreve links de convite antes do casamento de rota
│   ├── (auth)/           # login (1k)
│   ├── (onboarding)/     # escolha de artistas (1l)
│   ├── (tabs)/           # abas com a tab bar própria
│   │   ├── (inicio,explorar,ranking,perfil)/_layout.tsx  # uma pilha por aba
│   │   ├── (inicio)/ (explorar)/ (ranking)/ (perfil)/    # raiz e telas de cada aba
│   │   └── (inicio,explorar,perfil)/artista/[artistaId]  # rota compartilhada (1d)
│   ├── post/[postId].tsx # fora das abas: comentários com teclado
│   ├── convidar.tsx      # formSheet "Gerar meu link"
│   └── convite/[codigo]  # fora dos guards: guarda o código do convite
├── domains/<domínio>/    # auth, onboarding, home, explore, artists, posts, ranking,
│   │                     # missions, rewards, agenda, profile, invites
│   ├── views/            # telas (uma por arquivo, exportada pelo index.ts)
│   ├── components/       # peças só deste domínio
│   ├── hooks/            # hooks do domínio
│   ├── api.ts            # chamadas cruas (axios ou Firebase), sem React
│   ├── queries.ts        # React Query: chaves, queries, mutations
│   ├── schemas.ts        # zod
│   ├── types.ts
│   └── index.ts          # API pública do domínio; outros domínios importam só daqui
├── components/<nome>/    # UI compartilhada: text, button, icon, screen, header,
│                         # tab-bar, pressable-scale, text-input, progress-ring...
├── services/             # api (axios), firebase, query (client, persister, NetInfo),
│                         # haptics, storage
├── stores/               # Zustand: session (espelho do Auth), preferences (persistido)
├── hooks/                # use-tab-bar-inset, use-haptics, use-is-online, reduzir movimento
├── theme/                # colors, typography, spacing (radii, layout), shadows, motion
├── i18n/                 # translations.json (pt-BR) e t()
├── config/               # env (zod sobre EXPO_PUBLIC_*), zod (locale pt-BR)
├── providers/            # AppProviders
├── utils/                # date, number, color, id
├── navigation/           # testes da árvore de rotas
└── types/                # declarações globais (React Query, firebase/auth RN)
```

## Regras de código

- **Rota é fina.** Arquivo em `src/app` só faz `export default XScreen` vindo de `@/domains/<x>`. Lógica, estado e estilo ficam no domínio. Todo arquivo dentro de `src/app` vira rota, inclusive teste: testes de rota ficam em `src/navigation/__tests__`.
- **Nomes:** pastas e arquivos em kebab-case; componentes em PascalCase; telas com sufixo `Screen`; exports nomeados (default só nas rotas). Código e identificadores em inglês; nomes de rota em pt-BR, porque viram URL; texto visível em pt-BR via `t()`.
- **Imports** pelo alias `@/` (aponta para `src/`). Dentro do próprio domínio, relativo.
- TypeScript strict, sem `any`. Tipos de API ficam em `types.ts` do domínio.
- O lint transforma as decisões de stack em erro: `Text` do `react-native`, `FlatList`/`SectionList`, `expo-haptics` direto, `@expo/vector-icons`, moment/dayjs, yup, `@react-navigation/*` e libs de estilo. As exceções estão em `eslint.config.js`.
- Antes de dar uma tarefa por pronta: `npm run check` (tipos, lint e testes).

## Estilo

- `StyleSheet.create` no fim do arquivo, com tokens de `@/theme`. Nada de cor, fonte ou espaçamento solto no componente.
- Regra de cor do protótipo: fundo escuro, **rosa para ação, lima só para pontos**. Ciano é a cor de shows e agenda.
- Tons por opacidade com `withAlpha(cor, alpha)` de `@/utils/color`.
- Brilho colorido com `boxShadow` (tokens em `shadows`); `elevation` não tinge.
- Cada peso da fonte é uma família (`Sora_800ExtraBold`, `Manrope_600SemiBold`...). Nunca `fontWeight` com elas. O texto sai pelo `<Text variant>`.
- O app é só escuro (`userInterfaceStyle: 'dark'`).
- Contraste: texto secundário não desce de branco a .5 (o protótipo usa .42, que reprova AA). O botão primário usa `accentStrong` (#D9105A) porque branco sobre #FF2D6F dá 3,59:1. Isso diverge do protótipo e **precisa de aprovação**.

## Navegação

- **Guards:** o `_layout.tsx` raiz usa `Stack.Protected` com o status da sessão (`useSessionStore`) e `hasCompletedOnboarding` (`usePreferencesStore`). Telas não navegam para trocar de fluxo: mudou o estado, o guard troca a pilha.
- **Uma pilha por aba** via grupo em array `(inicio,explorar,ranking,perfil)/_layout.tsx`. A tela da base de cada aba sai de `unstable_settings[grupo].anchor`.
- **Artista é rota compartilhada** e abre dentro da aba de onde veio, com a tab bar. Vindo de link a frio, abre na aba Início com o Início embaixo na pilha (testado em `src/navigation/__tests__/routes.test.tsx`; a doc da Expo fala em ordem alfabética, o código não faz isso).
- **Tab bar** em `src/components/tab-bar`. `use-tab-items.ts` é o único arquivo que conhece `BottomTabBarProps`, que muda na SDK 58. A barra fica por cima do conteúdo: telas dentro das abas somam `useTabBarInset()` ao espaço de baixo. Tela que não deve mostrar a barra (teclado) fica fora de `(tabs)`, como `post/[postId]`. `tabBarHideOnKeyboard` e `tabBarStyle` não funcionam com barra própria.
- **Botão central** abre `/convidar`. No protótipo ele criava post de fã (fora do contrato); virar "Convidar" **precisa de aprovação da cliente por escrito**.
- **Headers:** todos os Stacks com `headerShown: false`. Os headers são componentes dentro do conteúdo (`LargeTitleHeader`, `BackHeader`, `GreetingHeader`), porque o design rola junto. Não use a prop `header` do Stack.
- **Sheets:** `presentation: 'formSheet'` do Stack, sem lib de bottom sheet. Testar o Android na primeira dev build.
- **Links:** esquema `imagineup://`. O `+native-intent` transforma `/c/CODIGO` e qualquer link com `?ref=CODIGO` em `/convite/CODIGO?destino=...`; essa rota guarda o código e segue. Quem credita os pontos é a API, depois do cadastro. Universal Links e App Links dependem do Team ID da Apple e do domínio (UP-46).
- **Rotas tipadas:** `.expo/types` é gerado pelo `expo start` ou por `npx expo customize tsconfig.json`. `router.push('/rota-que-nao-existe')` vira erro de tipo.

## Dados

- **Fluxo:** view → hook de `queries.ts` → `api.ts` → `@/services/api` (axios) ou `@/services/firebase`. View não chama axios nem Firebase.
- **React Query:** chaves por fábrica no domínio (`postKeys.detail(id)`), incluindo tudo que muda o resultado. O cache vai para o disco (`services/query/persister.ts`) e abre o app offline; dado sensível ou efêmero leva `meta: { persist: false }`. Mudou o formato de algo persistido? O `buster` (versão do app) descarta o cache antigo.
- **Offline:** sem internet, queries e mutations pausam e o `OfflineBanner` aparece. Mutation que precisa sobreviver a app fechado registra a função em `registerXMutationDefaults` (chamado no `AppProviders`) e usa `mutationKey`. Ação otimista desfaz no erro (modelo: `useToggleLikeMutation`).
- **axios** (`services/api/client.ts`): manda o ID token do Firebase, renova uma vez no 401 e devolve sempre `ApiError` (`kind`, `status`, `isRetryable`). Base em `EXPO_PUBLIC_API_URL`; sem ela, as queries ficam desligadas.
- **Zustand** guarda só estado do cliente: `session` (espelho do Firebase Auth, não persistido) e `preferences` (haptics, onboarding, persistido). Perfil, pontos e nível vêm da API pelo React Query.
- **Firebase:** inicialização preguiçosa em `services/firebase`. Sem `.env`, o app abre, avisa no console e não autentica. Sair limpa o cache do Query, inclusive o do disco.
- **Variáveis:** só `EXPO_PUBLIC_*`, lidas em `src/config/env.ts` com acesso estático. Local em `.env` (modelo no `.env.example`); nas builds, em Environment variables do projeto no expo.dev.

## Formulários, listas, datas

- **Formulário:** schema zod em `schemas.ts` do domínio, mensagens via `t()`, `useForm` com `zodResolver`. As mensagens padrão do zod saem em pt-BR (`src/config/zod.ts`).
- **Lista:** FlashList sempre. Na v2 não existe `estimatedItemSize`; use `getItemType` quando houver tipos de item diferentes, header e vazio como `ListHeaderComponent`/`ListEmptyComponent` e `paddingBottom` com a altura da tab bar. O header colapsável do artista (1d) vai pedir `stickyHeaderConfig`, que só existe na FlashList 2.3: suba a versão nessa hora e ponha o pacote em `expo.install.exclude`.
- **Data:** só por `@/utils/date` (date-fns com `ptBR` como padrão global). "Concluída às 14:02", "21 jun", "2 h" no feed.
- **Número:** `@/utils/number`. "12.480", "4,8 mil". Contador animado usa `formatThousandsWorklet`, porque worklet não tem Intl.

## Animação e haptics

- O dono quer movimento **fluido e discreto**: curvas suaves (`motion.easing.out`), molas de `motion.spring`, duração sincronizada com o movimento principal, nada de troca seca. Troca de cor entre rosa, lima e escuro interpola em HSV, não em RGB.
- **Sempre respeite "reduzir movimento"** (`usePrefersReducedMotion`). As animações do Reanimated já seguem o sistema; não passe `ReduceMotion.Never`.
- Reanimated para transformação, cor, layout, scroll e contadores. Com o React Compiler ligado, use `shared.get()` e `shared.set()`, não `.value`. Skia para o que o RN não desenha: anéis e gradiente cônico (`ProgressRing`), listras da marca, brilho com blur, confete.
- **Haptics só por evento semântico:** `haptics.trigger('like')` ou `useHaptics()`. A tabela em `src/services/haptics/patterns.ts` decide o toque de cada evento (`tap`, `selection`, `like`, `pointsEarned`, `missionComplete`, `levelUp`, `rankUp`, `redeem`, `insufficientPoints`, `locked`, `confirm`, `refresh`, `success`, `warning`, `error`...). O fã pode desligar nas preferências; rajada do mesmo evento vira um toque. `PressableScale` e `Button` recebem `haptic`.

## Acessibilidade

- Vale a regra do workspace (`.claude/rules/a11y-no-nested-pressables.md` em `Projetos`): props de a11y no pressável de fora, sem role nos filhos, alvo interno repetido oculto, `accessibilityLabel` sempre via `t()`.
- Alvo de toque mínimo de 44: use `hitSlop` quando o desenho for menor (botões de vidro de 36, chips, botão central).
- Ícone é decorativo por padrão (`Icon` já se esconde do leitor de tela).

## Testes

- jest-expo com `@testing-library/react-native` **13**. A 14 deixou o `render` assíncrono e quebra o `renderRouter` do expo-router 57.
- Lógica pura com teste em tabela (`utils`, `invites/deep-link`, `haptics`). Árvore de rotas com `renderRouter` em `src/navigation/__tests__`. Nome de teste descreve o comportamento, em português.

## Comandos

```bash
npm start                 # dev server (dev client); tecla s alterna para o Expo Go
npm run start:go          # direto no Expo Go (iPhone sem conta Apple)
npm run check             # tipos, lint e testes
npm run doctor            # expo-doctor
npm run build:dev:android # APK de desenvolvimento pela EAS
npm run build:preview:android
npm run update:preview    # OTA para o canal preview
```

## EAS

- Projeto `@imagineup-app/imagineup` no expo.dev (ID `6984e734-3efc-40bc-8b9b-4d65bffbe085`, no topo do `app.config.ts`), ligado em 2026-09-28. O eas-cli entra com a conta `thelozx`, admin da conta `imagineup-app`.
- As variáveis `EXPO_PUBLIC_*` das builds ficam em Environment variables do projeto no expo.dev, uma vez por ambiente (development, preview, production). Ainda estão vazias.
- Perfis em `eas.json`, cada um com o canal de mesmo nome: `development` (dev client, APK interno), `development-simulator` (iOS simulador), `preview` (APK interno), `preview-simulator`, `production` (`autoIncrement`, versão remota).
- `runtimeVersion` por **fingerprint**: update só chega a binário com o mesmo nativo. Mudou lib nativa, plugin ou SDK? Nova build antes de publicar update.
- Update é sempre manual (`npm run update:preview`), nunca automático no push.
- `.eas/workflows/testflight-ios.yml` (build de produção e envio ao TestFlight, no modelo do VerseUp) só roda à mão até existir a conta Apple; o arquivo diz o que ligar.
- **Sem conta Apple e sem Play Console:** Android funciona em APK interno com EAS Update; iOS só em build de simulador, que precisa de Mac para rodar. No iPhone, use o Expo Go. `eas submit` e Universal Links esperam as contas.
- Nunca commitar `.env`, `credentials.json`, `.p8`, `.p12`, `.jks` ou keystores.

## Git

- Repositório próprio, separado do `imagineup-painel`.
- Commits e PRs **sem** a linha `Co-Authored-By` do Claude e sem rodapé de atribuição: o repositório é da cliente (mesma regra do `imagineup-painel`).

## Pendências

- `.env` local e Environment variables da EAS com a config do Firebase (app da Web do projeto `imagine-up`).
- Aprovações da cliente: papel do botão central, seletor da aba Ranking (Ranking, Missões, Recompensas), raiz da aba Explorar, telas não desenhadas (detalhe do post e comentários, cadastro, ajustes com exclusão de conta), métodos de login (o protótipo pede Apple e celular; o Firebase está com e-mail e link por e-mail), CTA em `accentStrong`.
- Modelo de pontos com contadores separados: saldo gastável, XP de nível (não cai no resgate), pontos da temporada e pontos por central.
- Backend (M2): Cloud Functions para pontos, missões, convite e resgate; regras do Firestore bloqueando escrita de saldo.
- Ícone e splash são provisórios (seta da marca sobre o fundo escuro).
