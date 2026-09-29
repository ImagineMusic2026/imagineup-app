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

Pontos, níveis, missões e resgates são decididos **no servidor**. O app nunca grava saldo, e toda ação que vale ponto manda chave de idempotência. As regras (valores de pontos, missões, temporadas, recompensas) são ajustáveis pelo painel admin e chegam pela API: nada disso fica fixo no app.

## Stack (Expo SDK 57)

| Área                 | Escolha                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Base                 | Expo 57, React Native 0.86.3, React 19.2, TypeScript 6 (strict), Nova Arquitetura, React Compiler ligado                |
| Navegação            | Expo Router 57, abas JS de `expo-router/js-tabs` com tab bar própria                                                    |
| Estilo               | `StyleSheet` puro com os tokens de `src/theme`. Nenhuma lib de estilo                                                   |
| Dados do servidor    | TanStack Query 5 com axios, cache persistido no aparelho                                                                |
| Estado do cliente    | Zustand 5                                                                                                               |
| Formulários          | zod 4 com react-hook-form e `@hookform/resolvers`                                                                       |
| Autenticação e banco | Firebase, SDK JS 12 (projeto `imagine-up-app`, só do app; Firestore em southamerica-east1)                              |
| Animação             | Reanimated 4 (com react-native-worklets) e Skia 2                                                                       |
| Listas               | `@shopify/flash-list` 2                                                                                                 |
| Ícones               | `lucide-react-native`                                                                                                   |
| Datas                | date-fns 4 em pt-BR                                                                                                     |
| Haptics              | `expo-haptics` atrás de `src/services/haptics`                                                                          |
| Build e OTA          | EAS Build e EAS Update                                                                                                  |
| Backend              | Cloud Functions de 2ª geração em `functions/` (Node 24, firebase-functions 7, firebase-admin 14), em southamerica-east1 |
| Testes               | jest-expo com Testing Library 13                                                                                        |

## Decisões e o porquê

1. **Expo Router, não React Navigation.** O desenho da tab bar e dos headers não desempata: o Expo Router 57 traz o mesmo código do React Navigation por dentro, e a prop `tabBar` é a mesma. O que decidiu: o convite com atribuição (mês 3) sai da própria árvore de arquivos e do `+native-intent`; `Stack.Protected` separa login, onboarding e app; rotas tipadas; `renderRouter` testa deep link no Jest; e é o caminho oficial da SDK. Desde a SDK 56 não dá para importar `@react-navigation/*` com o Expo Router (o lint bloqueia).
2. **SDK JS do Firebase, não `@react-native-firebase`.** Sem conta Apple e sem Mac, o único jeito de testar no iPhone é o Expo Go, e o RNFB não roda nele. O custo: o Firestore do SDK JS só tem cache em memória no React Native, então o offline vem do React Query persistido, e não há Crashlytics, Analytics nem App Check nativo. Reavaliar quando a conta Apple sair.
3. **AsyncStorage, não MMKV.** Mesmo motivo (Expo Go). A troca fica contida em `src/storage/storage`, no persister do Query e no store de preferências. Se a troca acontecer, o `onRehydrateStorage` das preferências não pode usar `usePreferencesStore` direto: com storage síncrono ele roda dentro do `create`, antes de o store existir, e o app fica preso na splash.
4. **Estrutura do Delirium (`clubdelirium/mobile`) adaptada ao Expo Router.** Vieram de lá: `src/domains/<domínio>/{views,components,types.ts,consts.ts}`, `src/components/<nome>/index.tsx`, `src/firebase`, `src/storage/storage/{index,keys}.ts`, `src/theme/{colors,spacings,borders,shadow,index}.ts`, `src/hooks`, `src/providers` e `src/utils`. O que mudou, e por quê:
   - O Delirium tinha um nível de público (`domains/customer`, `domains/admin`). Aqui o app só tem o fã (o admin é o painel web), então os domínios ficam direto em `src/domains/<domínio>`.
   - O `index.tsx` de cada domínio do Delirium montava o navegador. Aqui as rotas são arquivos em `src/app`, e o `index.ts` do domínio vira a API pública dele.
   - O Delirium usava Context para estado (`src/contexts`); aqui o estado do cliente fica em `src/stores` (Zustand) e o do servidor no React Query.
   - Não havia camada de API no Delirium (tudo ia direto ao Firestore). Axios, React Query e haptics ficam em `src/services`.
   - O `secure-storage` entra quando houver segredo para guardar; a sessão do Firebase segue a persistência padrão do SDK JS, no AsyncStorage.
5. **Abas JS com tab bar própria, não NativeTabs.** As NativeTabs usam a barra do sistema e não aceitam o botão central nem o fundo em gradiente com blur do protótipo.

## Estrutura

```
src/
├── app/                  # rotas do Expo Router (só arquivos finos, até 3 linhas)
│   ├── _layout.tsx       # fontes, splash, providers, Stack raiz com Stack.Protected
│   ├── +native-intent.ts # reescreve links de convite antes do casamento de rota
│   ├── (auth)/           # abertura (1k), entrar com e-mail e cadastro, sobre o fundo da 1k
│   ├── (onboarding)/     # escolha de artistas (1l) e a sheet de todos os artistas
│   ├── (tabs)/           # abas com a tab bar própria
│   │   ├── (inicio,explorar,ranking,perfil)/_layout.tsx  # uma pilha por aba
│   │   ├── (inicio)/ (explorar)/ (ranking)/ (perfil)/    # raiz e telas de cada aba
│   │   ├── (inicio,explorar,ranking,perfil)/artista/[artistaId]  # rota compartilhada (1d)
│   │   └── (explorar,ranking)/agenda  # rota compartilhada (1m)
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
├── components/<nome>/    # UI compartilhada: text, button, icon, screen, header, tab-bar,
│                         # pressable-scale, text-input, progress-ring, error-boundary e os
│                         # primitivos do design (avatar, card, pill, chip, glass, stripes...)
├── firebase/             # config (app), auth, firestore
├── storage/storage/      # AsyncStorage com chaves versionadas (index, keys)
├── services/             # api (axios), query (client, persister, NetInfo), haptics
├── stores/               # Zustand: session (espelho do Auth), preferences (persistido)
├── hooks/                # use-session-gate, use-stack-screen-options, use-tab-bar-inset,
│                         # use-haptics, use-is-online, use-announce-offline, reduzir movimento
├── theme/                # colors, typography, spacings (layout), borders (raios), shadow,
│                         # motion, navigation
├── i18n/                 # translations.json (pt-BR) e t()
├── config/               # env (zod sobre EXPO_PUBLIC_*), zod (locale pt-BR)
├── providers/            # AppProviders
├── utils/                # date, number, color, id, form-errors, visible-line (espelho do firestore.rules)
├── navigation/           # testes da árvore de rotas
└── types/                # declarações globais (React Query, firebase/auth RN)

functions/                # Cloud Functions: pacote Node à parte (package.json, tsconfig e testes próprios)
├── src/index.ts          # gatilhos de conta (createUserProfile, deleteUserProfile) e as callables da equipe do painel
├── src/handlers.ts       # o que o gatilho de cadastro faz (confere a conta antes e depois)
├── src/store.ts          # gravações no Firestore (perfil, reserva do @, limpeza)
├── src/profile.ts        # nome do perfil e geração do @
├── src/visible-line.ts   # espelho de visibleLine() do firestore.rules
├── src/staff/            # equipe do painel: convites, aceite e gestão (callables)
└── test/                 # testes de ponta a ponta nos emuladores
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
- Contraste: texto secundário não desce de branco a .5 (o protótipo usa .42, que reprova AA). O botão primário usa `accentStrong` (#D9105A) porque branco sobre #FF2D6F dá 3,59:1. Isso diverge do protótipo e foi aprovado em 2026-09-28. Pela mesma regra, o vidro escuro com texto (`glassDarkStrong`, selos sobre foto) é .9, não o .68 do protótipo.

## Navegação

- **Guards:** o `_layout.tsx` raiz usa `Stack.Protected` com `useSessionGate()` (sessão e onboarding). Telas não navegam para trocar de fluxo: mudou o estado, o guard troca a pilha. No cadastro, a conta nasce logada antes de o nome ir para ela e de o perfil existir: `session.holdAuth()` segura o fã no grupo `(auth)` até o fim (`useSignUp`), e `guards.test.tsx` trava isso. A troca de grupo na pilha raiz sai seca (a tela antiga some antes de a nova montar): entrar e cadastrar seguram o fã até as telas de conta saírem em fade para o fundo escuro (`playAuthExit`), e a pilha `(auth)` entra do fundo escuro em fade; sem isso, a foto da 1k sumia num corte seco, com um quadro vazio antes da tela seguinte. A escolha de artistas (1l) faz o mesmo na ida para as abas: segue as centrais, sai em fade (`playStackExit('onboarding')`, de `hooks/use-stack-fade`) e só então conclui o onboarding; as abas entram do fundo escuro em fade (`useStackFade('tabs')` no `(tabs)/_layout.tsx`).
- **Navegar para rota barrada pelo guard não faz nada, nem avisa.** Quem sai de uma tela que fica fora dos guards (`convite/[codigo]`, `+not-found`) mira em `entryRoute(gate)`, que devolve login, onboarding ou o destino. Para voltar às abas que já existem, `router.dismissTo(..., { withAnchor: true })`; `replace` ou `<Redirect>` empilham outra árvore de abas. `src/navigation/__tests__/guards.test.tsx` trava os dois casos.
- **Abertura sem esperar a rede:** o uid da última sessão fica em `preferences.lastSessionUid`. Com ele, o app abre nas abas com o cache salvo enquanto o Firebase confirma a sessão (o SDK JS pode levar até 60 s com sinal ruim); se a sessão tiver caído, o listener derruba e os guards corrigem. Por isso o axios espera `auth.authStateReady()` antes de ler o usuário.
- **Uma pilha por aba** via grupo em array `(inicio,explorar,ranking,perfil)/_layout.tsx`. A tela da base de cada aba sai de `unstable_settings[grupo].anchor`.
- **Artista e Agenda são rotas compartilhadas** e abrem dentro da aba de onde vieram, com a tab bar: o artista em qualquer aba, a agenda na Explorar e na Ranking. Assim a missão da 1g que leva ao artista ou à agenda abre por cima dela, e o voltar devolve o fã às missões (sem a Ranking no grupo, o voltar caía no Início). O endereço vai sem o grupo (`/artista/[artistaId]`, `/agenda`): o Expo Router escolhe o grupo que casa com os segmentos da tela atual. Vindo de link a frio, o artista abre na aba Início e a agenda na Explorar, com a raiz da aba embaixo na pilha (testado em `src/navigation/__tests__/routes.test.tsx`; a doc da Expo fala em ordem alfabética, o código não faz isso). No Jest, os segmentos da última navegação ficam de um teste para o outro no mesmo arquivo: teste de link a frio vem antes dos que navegam para outra aba.
- **Tab bar** em `src/components/tab-bar`. `tab-items.ts` (`toTabItems`) é o único arquivo que conhece `BottomTabBarProps`, que muda na SDK 58; a `TabBar` só recebe itens prontos. A barra fica por cima do conteúdo: telas dentro das abas somam `useTabBarInset()` ao espaço de baixo. Tela que não deve mostrar a barra (teclado) fica fora de `(tabs)`, como `post/[postId]`. `tabBarHideOnKeyboard` e `tabBarStyle` não funcionam com barra própria.
- **Botão central "+"** (aprovado em 2026-09-28): abre um menu que expande, com Convidar, Missões e Recompensas, e espaço para opções futuras. A aba Ranking continua na barra (2 abas de cada lado do "+"). No protótipo ele criava post de fã, fora do contrato. O "+" gira até virar "×" e os atalhos sobem em leque (`components/tab-bar/center-menu.tsx`); fundo, voltar do Android, o próprio "×" ou tocar numa aba fecham o menu. A lista de atalhos mora em `@/domains/quick-actions` e vai passar a vir do painel admin.
- **Pilhas:** todo `Stack` usa `useStackScreenOptions()` (sem header, fundo escuro, sem animação com reduzir movimento). As opções de um navegador não passam para os aninhados, então cada pilha chama o hook.
- **Headers:** todos os Stacks com `headerShown: false`. Os headers são componentes dentro do conteúdo (`LargeTitleHeader`, `BackHeader`, `HomeHeader`), porque o design rola junto. Não use a prop `header` do Stack.
- **Sheets:** `presentation: 'formSheet'` do Stack, sem lib de bottom sheet. No Android pelo Expo Go, a sheet de todos os artistas (`sheetAllowedDetents: [1]`) abre em altura cheia, fecha no voltar e aceita o `autoFocus` da busca; conferir de novo na primeira dev build, com teclado virtual. O `sheetGrabberVisible` só vale no iOS (react-native-screens 4.26): no Android, a própria tela desenha o puxador.
- **Links:** esquema `imagineup://`. O `+native-intent` transforma `/c/CODIGO` e qualquer link com `?ref=CODIGO` em `/convite/CODIGO?destino=...` (inclusive o `exp://.../--/` do Expo Go); essa rota guarda o código e segue. Quem credita os pontos é a API, depois do cadastro. Universal Links e App Links dependem do Team ID da Apple e do domínio (UP-46).
- **Rotas tipadas:** `.expo/types` é gerado pelo `expo start` ou por `npx expo customize tsconfig.json`. `router.push('/rota-que-nao-existe')` vira erro de tipo.

## Dados

- **Fluxo:** view → hook de `queries.ts` → `api.ts` → `@/services/api` (axios) ou `@/firebase`. View não chama axios nem Firebase.
- **React Query:** chaves por fábrica no domínio (`postKeys.detail(id)`), incluindo tudo que muda o resultado. O cache vai para o disco (`services/query/persister.ts`) e abre o app offline; dado sensível ou efêmero leva `meta: { persist: false }`. Mudou o formato de algo persistido? Suba `QUERY_CACHE_VERSION` (`services/query/persister.ts`), que viaja no EAS Update. A `version` do app não serve: ela entra no fingerprint e mudá-la corta o update dos binários instalados.
- **Dados provisórios:** enquanto a API (M2) não existe, `dataSource` (`src/config/env.ts`) é `fixtures`: o `api.ts` de cada domínio devolve fixtures tipadas de `fixtures.ts`, com datas relativas a `fixtureNow()`, e a view e o `queries.ts` não sabem de onde veio. Nesse modo só o dado de verdade vai para o cache do disco (o perfil do Firestore, com `meta: { realData: true }`) e as queries não pausam offline (`networkMode: always`); mutações continuam `online`. Os três contadores de pontos atravessam domínios em `fixtureWallet` (`src/services/fixtures`). Ação de outro domínio que anda uma missão conta em `missionsFixture.record(ação)` (`@/domains/missions`; hoje, o "Eu vou" da agenda): quando conclui, os pontos da missão entram na carteira e voltam no `pointsAwarded` da ação, e a 1g festeja (check, "+N" e haptic `missionComplete`) quando o fã volta a ela. Com `EXPO_PUBLIC_API_URL` preenchida, tudo passa para a API. O perfil básico (`users/{uid}`) já vem do Firestore de verdade (`profile/api.ts`, com `getDoc` e `onSnapshot`; o `Timestamp` vira ISO antes do cache), só lê com a sessão confirmada e usa `networkMode: 'online'` explícito; enquanto ele não chega (a função de cadastro leva segundos), `useFanIdentity` mostra o nome da sessão. A escuta ignora o "não existe" que vem do cache do SDK (sem rede, na abertura a frio), para não apagar o perfil salvo.
- **Offline:** sem internet, queries e mutations pausam e o `OfflineBanner` aparece. Mutation que precisa sobreviver a app fechado registra a função em `registerXMutationDefaults` (chamado no `AppProviders`) e usa `mutationKey`. Ação otimista desfaz no erro (modelo: `useToggleLikeMutation`). Mutações pausadas voltam todas juntas quando a rede volta: ações que se anulam (curtir e descurtir, "Eu vou" e desfazer) levam `scope` para sair em fila. Ação que o fã espera para seguir em frente (entrar, cadastrar, seguir as centrais da 1l) não entra na fila: usa `networkMode: 'always'`, e sem rede o erro aparece na hora para ele tentar de novo.
- **axios** (`services/api/client.ts`): manda o ID token do Firebase, renova uma vez no 401 e devolve sempre `ApiError` (`kind`, `status`, `isRetryable`). Base em `EXPO_PUBLIC_API_URL`; sem ela, as telas usam os dados provisórios.
- **Zustand** guarda só estado do cliente: `session` (espelho do Firebase Auth, não persistido) e `preferences` (haptics, onboarding, persistido). Perfil, pontos e nível vêm da API pelo React Query.
- **Regras do Firestore** em `firestore.rules` (com `firebase.json` e `.firebaserc` apontando para `imagine-up-app`), publicadas em 2026-09-28. Tudo fechado. **O perfil `users/{uid}` nasce no servidor**, no cadastro, com createdAt, @, pontos e foto; o celular só lê o próprio perfil e edita `displayName` e `city`, sempre com `updatedAt: serverTimestamp()` e no máximo uma edição a cada 10 s. Nome e cidade passam por `visibleLine()`: uma linha visível, sem espaço nas pontas, sem caractere em branco, sem mais de 3 acentos seguidos e com o ZWJ só entre emoji (a cantora 👩‍🎤 passa). O motor de regras classifica caracteres com tabelas antigas do Unicode (6.0 no emulador) e não reconhece os invisíveis mais novos, por isso a lista explícita em `blankChars()`: caractere invisível novo entra ali, com teste. O `updatedAt` é o carimbo de edição do fã, e o servidor não grava esse campo em `users/{uid}` (se gravar, o fã fica 10 s travado). O app espelha essas regras em `src/utils/visible-line.ts` (`isVisibleLine`, e `cleanLine`, que tira do texto colado os isolantes bidi U+2066 a U+2069, que a regra recusa): o nome do cadastro já usa, e a edição de perfil vai usar. A foto é gravada pelo servidor depois de validar o upload. Pontos, nível, @, convites, missões, ranking e centrais são só do servidor (Admin SDK). Mudou a regra? `npm run test:rules` (emulador; testes em `tests/`, com `tsconfig` próprio, um arquivo por vez) e depois `npm run rules:deploy`. O firebase-tools 15 exige Java 21: nesta máquina o Java do sistema está quebrado, use o do Android Studio (`JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"`). O CI roda os mesmos testes com Java 21.
- **Projeto Firebase `imagine-up-app`:** fica na conta Google da Imagine Music, como pede o contrato; a conta talisfilipe54@gmail.com, usada pela CLI desta máquina, entra como colaboradora. Entrada por e-mail e senha ativada no Authentication em 2026-09-28 (a CLI não liga provedores; outro método, como Apple ou Google, se ativa no console).
- **Cloud Functions** em `functions/`, pacote Node à parte (instale com `npm --prefix functions install`); o lint, o `tsc` e o Jest da raiz ignoram a pasta. Gatilhos de Auth de 2ª geração (`onUserCreated` e `onUserDeleted` de `firebase-functions/identity`), com `retry: true` e região `southamerica-east1` fixada no `setGlobalOptions` (sem ela, vão para os EUA). A doc do Firebase ainda chama esses gatilhos de Preview, embora o SDK 7.4 os declare GA.
  - `createUserProfile` cria `users/{uid}` a cada conta nova (e-mail e senha, Apple, Google ou Admin SDK) com `displayName`, `username`, `city: null`, `photoURL: null` e `createdAt`, e reserva o @ em `usernames/{@}` na mesma transação. Nunca grava `updatedAt`. O nome é o do registro atual do Auth (`getUser`), não o do evento: o SDK JS cria a conta sem nome, então a tela de cadastro chama `updateProfile` logo depois de `createUserWithEmailAndPassword`. Se o nome chegar depois da função, o @ fica `fa` com dígitos. O nome vem do Auth, que aceita qualquer texto pela API REST, então passa por `isVisibleLine` (espelho de `visibleLine()` do `firestore.rules`, como `src/utils/visible-line.ts` no app: mudou um, mude os três e os testes dos três); nome longo perde as últimas palavras até caber em 60, e nome inválido vira null para o fã preencher. A foto do provedor não é copiada.
  - O @ é o primeiro nome mais as 3 primeiras letras do último, sem acento ("Camila Ribeiro" vira `camilarib`), com 2 ou 4 dígitos se já existir; sem nome latino, curto ou parecido com a marca e a equipe, vira `fa` com 6 dígitos. `usernames/` é só do servidor. Variações com número no lugar de letra ("adm1n") ou "rn" no lugar de "m" também caem no `fa`.
  - `deleteUserProfile` apaga as reservas de @ e o perfil com as subcoleções quando a conta é excluída. Dado novo do fã fora de `users/{uid}` (carteira, convites) precisa entrar em `deleteUserData`. A reserva só é apagada se não mudou desde a leitura (`lastUpdateTime`), para uma limpeza atrasada não levar o @ que outra fã tomou depois.
  - A entrega é "pelo menos uma vez" e sem ordem garantida: a criação não repete (perfil existente fica como está), e `handleUserCreated` confere a conta antes e depois de gravar: se ela sumiu, desfaz o perfil e a reserva. Sem a segunda conferência, excluir a conta nos milissegundos da criação deixava o @ (às vezes o perfil) de uma conta morta. O perfil chega alguns segundos depois do cadastro, então a tela de cadastro espera `users/{uid}` aparecer (`onSnapshot`, até 20 s) antes de liberar o app.
  - Os scripts fixam `firebase-tools@15.32.0`: o `@15` resolvia para o 15.15.0 instalado na máquina, que não publica nem emula gatilhos de Auth de 2ª geração (precisa de 15.30.2 ou mais). Publicadas em 2026-09-29 no `imagine-up-app` (plano Blaze). O primeiro deploy do projeto ligou as APIs de Functions, Cloud Build, Artifact Registry, Eventarc e Cloud Run, falhou uma vez com "Permission denied while using the Eventarc Service Agent" (as permissões levam alguns minutos para propagar; repetir resolve) e precisou de `--force` para criar a política que apaga as imagens antigas depois de 1 dia.
  - `npm run test:functions` usa o projeto `demo-imagine-up-app`, para o emulador não falar com o projeto real, e sobe o prazo de descoberta das funções para 60 s (`FUNCTIONS_DISCOVERY_TIMEOUT`, via `cross-env` por causa do cmd do Windows). Com os 10 s padrão, a primeira execução depois de instalar estourava o prazo, e o `emulators:exec` rodava os testes sem gatilho nenhum; o `beforeAll` do teste agora falha logo se as funções não carregaram. O `functions/tsconfig.json` cobre `src` e `test`: sem isso, o vitest procura o tsconfig da raiz, que depende do Expo e quebra no CI. O build usa `tsconfig.build.json`.
- **Emuladores no app:** com `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST` no `.env` (e só em desenvolvimento, pelo `__DEV__`), o app usa o projeto `demo-imagine-up-app` e liga Auth (9099) e Firestore (8080) nos emuladores de `npm run emulators`, que também rodam as Cloud Functions e aplicam o `firestore.rules`. No emulador Android o host é `10.0.2.2` (o computador visto de dentro dele). As contas de teste ficam em `scripts/seed-emulators.mjs` e somem quando os emuladores fecham. O `scripts/emulators.mjs` põe o `java` do `JAVA_HOME` na frente do PATH, porque o emulador do Firestore precisa de Java 21. Vazio, o app volta para o projeto real. Trocou a variável? Reinicie o Metro.
- **Firebase:** inicialização preguiçosa em `src/firebase`. Sem `.env`, o app abre, avisa no console e não autentica. Sempre que o Auth diz "sem sessão" (sair no app ou sessão que caiu por fora), o cache do Query vai embora, inclusive o do disco, antes de o guard liberar a próxima tela.
- **Variáveis:** só `EXPO_PUBLIC_*`, lidas em `src/config/env.ts` com acesso estático. Local em `.env` (modelo no `.env.example`); nas builds, em Environment variables do projeto no expo.dev, já preenchidas nos três ambientes com a config do app Web "ImagineUP (app)". O SDK JS usa essa mesma config no iOS e no Android; os apps iOS e Android também estão registrados no `imagine-up-app` (`br.com.imaginegroup.imagineup`) para quando entrarem login com Google, Crashlytics ou App Check.

## Equipe do painel

- **Quem entra:** só quem tem `staff/{uid}` com `status: 'active'`. A equipe usa o mesmo Authentication dos fãs, mas estar logado nunca basta e custom claims não contam: regras e funções leem `staff/{uid}` a cada pedido, então desativar corta na hora. Papéis `admin` (tudo, e gerencia a equipe), `editor` (altera as seções liberadas) e `viewer` ("Leitor", só vê). As seções são `SECTION_IDS` em `functions/src/staff/model.ts`; admin grava sempre todas. Conta que já existia e foi ligada pelo `linkStaffInvite` grava `authValidAfter` (o `auth_time` do login que ligou): sessão com login anterior não usa o acesso, nas regras (`staffSessionAllowed`) e nas funções (`sessionAllowed`), porque qualquer um cria conta no app com o e-mail de outra pessoa e o token dela ainda vale até 1 h depois de a senha ser recuperada. Admin desativado, rebaixado ou removido perde, na mesma transação, os convites pendentes que criou ou reenviou (`invitedBy` ou `lastSentBy`): senão voltaria aceitando um link guardado.
- **Dados, só do servidor:** `staff/{uid}`, `staffInvites/{id}` (guarda só o sha256 do token; o token vai no fragmento do link `PANEL_URL/convite/{id}#token`, vale 7 dias e uma vez; reenviar troca o token) e `staffAudit/{id}` (uma entrada por mudança, com o nome de quem fez). Pelo cliente ninguém grava, nem admin. O membro lê o próprio doc em qualquer status (o painel mostra "acesso desativado"), admin lê e lista equipe e convites, e a auditoria exige a seção `audit` ou admin. `canEditSection` já está no `firestore.rules` para as seções que o painel vai editar.
- **Callables** em `functions/src/staff/`, exportadas no `src/index.ts` depois do `setGlobalOptions` (o `onCall` lê a região quando é definido). Todas com `cors: PANEL_ORIGINS` (`config.ts`: só `http://localhost:3000` até o painel ser publicado) e erro `HttpsError(código, mensagem em pt-BR, { reason })`. Admin ativo: `createStaffInvite`, `resendStaffInvite`, `cancelStaffInvite`, `updateStaffMember`, `setStaffMemberActive`, `removeStaffMember`. Página do convite: `getStaffInvite` e `acceptStaffInvite` (sem login, conta nova) e `linkStaffInvite` (logado, conta que já existe). Lógica pura em `model.ts`, `token.ts` e `email.ts`, com testes ao lado; Firestore e Auth em `service.ts`, com o Auth injetável.
- **Fã e equipe separados:** o aceite grava `staff/{uid}` pending, com o uid gerado antes do `createUser`, e o `createUserProfile` devolve `{ status: 'staff' }` quando a marca existe (qualquer status): conta da equipe não ganha perfil nem @. A exceção é a marca com `accountCreatedByInvite: false` (fã ligada), que ganha o perfil mesmo com o gatilho atrasado. Fã convidado liga o acesso na mesma conta (`linkStaffInvite`) e o perfil de fã fica; a função confere o e-mail da conta de agora (não só o do token) e, se ele nunca foi confirmado, tira os provedores que não são a senha nem o do login. `removeStaffMember` só apaga a conta do Auth se ela nasceu no convite e não tem `users/{uid}`. `deleteUserData` também apaga `staff/{uid}`.
- **Aceite idempotente:** reserva `acceptingUid` numa transação, cria a conta (ou continua a de uma tentativa que caiu no meio, com a senha nova) e só então ativa. Convite cancelado no meio desfaz a conta; e-mail que ganhou conta no meio solta a reserva e responde `account-exists`. A reserva de uma tentativa anterior só vale enquanto a marca pendente dela existe: o admin tirar o membro pendente solta a reserva no convite, e um aceite em andamento responde `conflict` e desfaz a conta em vez de reviver a marca. Cancelar ou trocar o convite apaga a reserva de um aceite que caiu no meio (marca e conta), e o e-mail volta a ser convidável. Ninguém muda o próprio acesso (`self`) e o último admin ativo não sai (`last-admin`): as duas coisas são conferidas na transação, com o admin que chama relido nela.
- **E-mail pelo EmailJS, no servidor:** secret `EMAILJS_PRIVATE_KEY` só nas duas funções que mandam e-mail; parâmetros `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY` e `PANEL_URL` (nomes em `functions/.env.example`, valores em `functions/.env.imagine-up-app`, fora do git). Service, template ou chave pública vazios: não chama a API e o convite sai com `emailStatus: 'skipped'`, para o admin copiar o link. Falha no envio não desfaz o convite. O log nunca leva a chave nem o link. No EmailJS: liberar a API para aplicações fora do navegador e desligar o histórico do template (o link ficaria guardado lá).
- **Emulador:** `scripts/functions-emulator-env.mjs` cria `functions/.env.demo-imagine-up-app` (EmailJS vazio) e `functions/.secret.local` (chave falsa) se faltarem; roda sozinho no `npm run test:functions` e no `npm run emulators`. Sem eles, o emulador para e pergunta cada parâmetro no terminal (o CI trava) e grava as respostas em `functions/.env.local`, que passa por cima do arquivo do projeto. Os testes das funções se recusam a rodar com o EmailJS configurado nesses arquivos, porque mandariam convite de verdade.
- **Primeiro admin:** `npm --prefix functions run build` e `node scripts/staff-bootstrap-invite.mjs pessoa@exemplo.com`. Com `FIRESTORE_EMULATOR_HOST`, grava no emulador; sem ele, só grava com `--project imagine-up-app` escrito, com as Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS` com uma chave fora do repositório, ou `gcloud auth application-default login`), e mostra o destino antes de gravar. Recusa se já há admin ativo, se o e-mail já é da equipe ou se há convite pendente e ainda válido para ele (vencido é trocado). Não manda e-mail: mostra o link (base em `PANEL_URL`, padrão `http://localhost:3000`).
- **Testes:** `tests/staff-rules.test.ts` (regras) e `functions/test/staff.emulator.test.ts` (callables nos emuladores, corridas com o Auth trocado e o script do primeiro admin). Publicar: o secret antes (`npx --yes firebase-tools@15.32.0 functions:secrets:set EMAILJS_PRIVATE_KEY --project imagine-up-app`; sem ele o deploy para e pergunta), o `functions/.env.imagine-up-app` preenchido, depois `npm run rules:deploy` e `npm run functions:deploy`.

## Formulários, listas, datas

- **Formulário:** schema zod em `schemas.ts` do domínio, mensagens via `t()`, `useForm` com `zodResolver`. As mensagens padrão do zod saem em pt-BR (`src/config/zod.ts`). O `.max()` de texto do zod 4 conta pontos de código (emoji vale 1); o limite do nome (60) conta unidades de UTF-16, como a função de cadastro, então é um `refine`.
- **Lista:** FlashList sempre. Na v2 não existe `estimatedItemSize`; use `getItemType` quando houver tipos de item diferentes, header e vazio como `ListHeaderComponent`/`ListEmptyComponent` e `paddingBottom` com a altura da tab bar. Nada de estilo pelo `index` do item (coluna da grade, primeiro da lista): quando só a posição muda (a busca tira os de antes), a FlashList reaproveita a célula sem chamar o `renderItem`, e o estilo fica o da posição antiga. O header colapsável do artista (1d) vai pedir `stickyHeaderConfig`, que só existe na FlashList 2.3: suba a versão nessa hora e ponha o pacote em `expo.install.exclude`.
- **Data:** só por `@/utils/date` (date-fns com `ptBR` como padrão global). "Concluída às 14:02", "21 jun", "2 h" no feed.
- **Número:** `@/utils/number`. "12.480", "4,8 mil". Contador animado usa `formatThousandsWorklet`, porque worklet não tem Intl.

## Animação e haptics

- O dono quer movimento **fluido e discreto**: curvas suaves (`motion.easing.out`), molas de `motion.spring`, duração sincronizada com o movimento principal, nada de troca seca. Troca de cor entre rosa, lima e escuro interpola em HSV, não em RGB.
- **Sempre respeite "reduzir movimento"** (`usePrefersReducedMotion`). O `AppProviders` espelha a opção no `ReducedMotionConfig` do Reanimated, que sozinho só lê o valor da abertura do app; com isso as animações seguem o sistema. Não passe `ReduceMotion.Never` numa animação.
- Reanimated para transformação, cor, layout, scroll e contadores. Com o React Compiler ligado, use `shared.get()` e `shared.set()`, não `.value`. Skia para o que o RN não desenha: anéis e gradiente cônico (`ProgressRing`), listras da marca, brilho com blur, confete.
- **Haptics só por evento semântico:** `haptics.trigger('like')` ou `useHaptics()`. A tabela em `src/services/haptics/patterns.ts` decide o toque de cada evento (`tap`, `selection`, `like`, `pointsEarned`, `missionComplete`, `levelUp`, `rankUp`, `redeem`, `insufficientPoints`, `locked`, `confirm`, `refresh`, `success`, `warning`, `error`...). O fã pode desligar nas preferências; rajada do mesmo evento vira um toque. `PressableScale` e `Button` recebem `haptic`, que dispara no `onPress` (no início do toque, rolar sobre um card vibraria).

## Acessibilidade

- Vale a regra do workspace (`.claude/rules/a11y-no-nested-pressables.md` em `Projetos`): props de a11y no pressável de fora, sem role nos filhos, alvo interno repetido oculto, `accessibilityLabel` sempre via `t()`.
- Alvo de toque mínimo de 44. `hitSlop` só vale dentro da área do pai: no Fabric do iOS, toque fora do pai não chega. Quando o pai é justo (tab bar), cresça o próprio pressável e desenhe o visual menor dentro.
- Ícone é decorativo por padrão (`Icon` já se esconde do leitor de tela).
- O toque duplo do VoiceOver chega ao `PressableScale` pelo `onAccessibilityTap`. Sem ele, o Fabric do iOS deixa o sistema simular um toque no centro do elemento, que cai no que estiver por cima (rodapé fixo da 1l com a fonte grande, teclado). Todo tocável do app passa pelo `PressableScale`.
- O iOS não tem live region nem papel "alert": mensagem de status (sem internet, erro de login) é anunciada com `AccessibilityInfo.announceForAccessibility`, num lugar só. O papel "tab" também não existe no iOS; a tab bar usa "button" lá, como o React Navigation.
- Campo de formulário recebe o `ref` do `Controller`, para o envio inválido levar o foco ao primeiro erro. Rótulo e erro chegam ao leitor pelo próprio campo. O envio inválido também anuncia o primeiro erro (`announceFirstError` de `@/utils/form-errors`, no segundo argumento do `handleSubmit`): focar o campo que já estava focado (o "ir" do teclado na senha) não faz o leitor falar. Regra do campo ("Pelo menos 6 caracteres") vai no `hint`, nunca só no placeholder.
- O texto cresce até 200% (WCAG 1.4.4); só as variantes minúsculas presas a layout fixo têm limite menor (em `components/text`).

## Testes

- jest-expo com `@testing-library/react-native` **13**. A 14 deixou o `render` assíncrono e quebra o `renderRouter` do expo-router 57.
- Lógica pura com teste em tabela (`utils`, `invites/deep-link`, `auth/schemas`, `haptics`). Árvore de rotas e guards com `renderRouter` em `src/navigation/__tests__`. Nome de teste descreve o comportamento, em português.
- O Jest roda com o mock do Reanimated (`jest.setup.js`), o resolver do `react-native-worklets` e o lucide apontado para o build CommonJS (`jest.config.js`); sem isso, qualquer teste que importe o tema ou um ícone quebra. O Skia usa o mock do próprio pacote sobre um CanvasKit que não desenha: teste de componente com Skia confere a árvore e a acessibilidade, não pixel. O `expo-router/testing-library` troca o mock do Reanimated pelo simples quando é importado; o `jest.after-env.js` devolve o `useReducedMotion` e o `ReducedMotionConfig` depois dos imports. No Jest, `firebase/*` resolve para o build ESM, que não roda: teste que importa código com Firebase (`@/firebase`, `@/services/api` ou o `api.ts` de um domínio) faz `jest.mock` de `firebase/app`, `firebase/auth`, `firebase/firestore` e `@/firebase` (modelo em `src/navigation/__tests__/auth.test.tsx`). Por isso o `index.ts` de um domínio que o teste de guards importa (`invites`) não puxa a API. Sem layout nativo, a FlashList não desenha item nenhum no Jest: o teste que precisa dos itens faz o `jest.mock` de `@shopify/flash-list/dist/recyclerview/utils/measureLayout` (modelo em `src/navigation/__tests__/onboarding.test.tsx`).

## Comandos

```bash
npm start                 # dev server (dev client); tecla s alterna para o Expo Go
npm run start:go          # direto no Expo Go (iPhone sem conta Apple)
npm run check             # tipos, lint e testes
npm run test:rules        # regras do Firestore no emulador (Java 21)
npm run rules:deploy      # publica regras e índices no imagine-up-app
npm run test:functions    # Cloud Functions nos emuladores de Auth, Firestore e Functions (Java 21)
npm run emulators         # Auth, Firestore e Functions locais para o app (projeto demo, Java 21)
npm run emulators:seed    # contas de teste nos emuladores (rode com os emuladores abertos)
npm run functions:deploy  # publica as Cloud Functions no imagine-up-app
npm run doctor            # expo-doctor
npm run build:dev:android # APK de desenvolvimento pela EAS
npm run build:preview:android
npm run update:preview    # OTA para o canal preview
```

## EAS

- Projeto `@imagineup-app/imagineup` no expo.dev (ID `6984e734-3efc-40bc-8b9b-4d65bffbe085`, no topo do `app.config.ts`), ligado em 2026-09-28. O eas-cli entra com a conta `thelozx`, admin da conta `imagineup-app`.
- As variáveis `EXPO_PUBLIC_*` das builds ficam em Environment variables do projeto no expo.dev, uma vez por ambiente (development, preview, production), já preenchidas com a config do Firebase `imagine-up-app`.
- Perfis em `eas.json`, cada um com o canal de mesmo nome: `development` (dev client, APK interno), `development-simulator` (iOS simulador), `preview` (APK interno), `preview-simulator`, `production` (`autoIncrement`, versão remota).
- `runtimeVersion` por **fingerprint**: update só chega a binário com o mesmo nativo. Mudou lib nativa, plugin ou SDK? Nova build antes de publicar update. Os scripts do `package.json` e o `.gitignore` da raiz também entram no fingerprint.
- Update é sempre manual (`npm run update:preview`), nunca automático no push.
- `.eas/workflows/testflight-ios.yml` (build de produção e envio ao TestFlight, no modelo do VerseUp) só roda à mão até existir a conta Apple; o arquivo diz o que ligar.
- **Sem conta Apple e sem Play Console:** Android funciona em APK interno com EAS Update; iOS só em build de simulador, que precisa de Mac para rodar. No iPhone, use o Expo Go. `eas submit` e Universal Links esperam as contas.
- Nunca commitar `.env`, `credentials.json`, `credentials/`, `.p8`, `.p12`, `.jks`, `.keystore` ou a chave de conta de serviço do Play; o `.gitignore` já cobre, e o repositório é público.

## Git

- Repositório `ImagineMusic2026/imagineup-app` no GitHub, na conta da cliente e **público** (decisão do dono). Nada sensível entra nele.
- Commits e PRs **sem** a linha `Co-Authored-By` do Claude e sem rodapé de atribuição: o repositório é da cliente (mesma regra do `imagineup-painel`).

## Aprovações de 2026-09-28

- **Botão "+" do meio:** abre um menu que expande, com Convidar, Missões e Recompensas, e espaço para opções futuras. A aba Ranking continua na barra. Substitui o post de fã do protótipo, que está fora do contrato.
- **Telas sem desenho** (post com comentários, cadastro, ajustes com exclusão de conta): seguem o mesmo visual das outras telas, sem nova rodada de protótipo.
- **Entrada no app:** começa por e-mail e senha; depois entram Apple, Google e o login automático, sem o fã escolher o método a cada abertura.
- **Botão primário em `accentStrong` (#D9105A):** aprovado.
- **Pontos em três contadores:** saldo para trocar por recompensas, nível (não cai no resgate) e pontos da temporada para o ranking.
- **Regras ajustáveis pelo painel admin:** valores de pontos, missões, temporadas e recompensas vêm da API. Nada disso fica fixo no app.
- **Aba Explorar:** a primeira tela continua sem definição; a aba fica com o placeholder.

## Aprovações de 2026-09-29 (design nas telas)

O plano de construção do design saiu de um levantamento tela por tela do protótipo. Aprovadas as propostas padrão:

- **Abertura (1k):** botão principal rosa `accentStrong`, como o resto do app.
- **Missões, Resgatar e Agenda (1g, 1h, 1m):** a seta de voltar fica na linha do título (`LargeTitleHeader` com voltar), sem empurrar o título.
- **Escolher artistas (1l):** mínimo de 3; abaixo disso o botão fica desabilitado e diz quantos faltam.
- **Contadores:** o "SEUS PONTOS" da 1e é o saldo para resgatar (o mesmo da 1h); a barra, o anel e o "Faltam ..." usam o XP de nível, que nunca cai. A home (1b) segue o protótipo, sem saldo no header.
- **Segundo post da home (1b):** sai o post de playlist; entra um post de show com "Eu vou", que conta como presença na agenda.
- **Resgate (1h):** detalhe, confirmação e instruções no visual das outras telas, sem pedir endereço no app; a entrega física fica com a equipe.
- As outras perguntas do levantamento (lista de artistas, textos jurídicos, idade no cadastro, moderação de comentários, regras do ranking) seguem propostas padrão fáceis de trocar e vão numa lista para a cliente.

## Pendências

- Desenhar as telas que faltam no visual das outras.
- Primeira tela da aba Explorar, ainda sem definição.
- Métodos de entrada além de e-mail e senha: Apple, Google e login automático.
- Modelo de pontos no backend com os três contadores aprovados, mais os pontos por central.
- Foto da abertura (slot `up-1k-bg`) não entregue: até lá, o fundo da 1k é o placeholder rosa para roxo (`gradients.authPhotoFallback`).
- Termos e privacidade abrem `imagineup-painel.vercel.app/termos/` e `/privacidade/` (`auth/consts.ts`) até o domínio próprio (UP-46).
- Links compartilhados do app (`/post/ID?ref=CODIGO`, em `invites/consts.ts`) caem no 404 do site, que ainda não tem essas páginas. Proposta para o dono: o `vercel.json` do `imagineup-painel` manda `/post/:id/` e `/artista/:id/` para `/baixar/`, mantendo o caminho e o `?ref=` para os App Links (UP-46).
- Idade e consentimento do responsável no cadastro (LGPD, art. 14): pergunta para a cliente; o cadastro não pede idade.
- Decidir se o @ automático (`fa` com dígitos) vira o @ do nome quando o nome chega depois do cadastro (Apple sem nome, nome digitado numa tela seguinte). Hoje o @ não muda.
- Backend (M2): pontos, missões, convite e resgate em Cloud Functions. As regras já bloqueiam saldo, nível e @ pelo celular.
- Convite no cadastro (M2): se o envio à API falhar, o código fica no aparelho e só volta a ir no próximo cadastro feito nele, que seria de outra conta, com a mesma chave de idempotência. Com o endpoint real, amarrar o convite pendente ao uid (e à chave) e tentar de novo na abertura só para essa conta.
- Ícone e splash são provisórios (seta da marca sobre o fundo escuro).
