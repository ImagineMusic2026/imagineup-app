# ImagineUP

App de fãs dos artistas da Imagine Music, para iOS e Android. Expo SDK 57 com Expo Router.

As decisões de arquitetura, a estrutura de pastas e as regras do projeto estão no [CLAUDE.md](CLAUDE.md).

## Requisitos

- Node 22.13 ou mais novo.
- EAS CLI 18 ou mais novo: `npm i -g eas-cli@latest`, depois `eas login`.
- Para Android: um aparelho com o APK de desenvolvimento, ou o emulador do Android Studio.
- Para iPhone, enquanto não houver conta Apple Developer nem Mac: o app Expo Go.

## Primeira vez

```bash
npm install
cp .env.example .env   # preencha com a config do app da Web do Firebase (projeto imagine-up-app)
npm start
```

No terminal do `npm start`, a tecla `s` alterna entre a build de desenvolvimento e o Expo Go. Para ir direto ao Expo Go: `npm run start:go`.

Com o Firebase sem configuração o app abre, mas fica na tela de login com o aviso.

## Builds e atualizações

| Comando                         | O que faz                                                  |
| ------------------------------- | ---------------------------------------------------------- |
| `npm run build:dev:android`     | APK de desenvolvimento (dev client), canal `development`   |
| `npm run build:dev:ios-sim`     | Build de simulador iOS (precisa de Mac para rodar)         |
| `npm run build:preview:android` | APK interno para teste, canal `preview`                    |
| `npm run update:preview`        | Atualização pelo ar (OTA) para quem tem a build de preview |

As atualizações pelo ar só chegam a builds com o mesmo nativo (`runtimeVersion` por fingerprint). Mudou dependência nativa, plugin ou SDK: gere build nova antes.

## Checagens

```bash
npm run check   # tipos, lint e testes
npm run doctor  # expo-doctor
```

## Firebase

As regras do Firestore (`firestore.rules`) e as Cloud Functions (`functions/`) moram aqui e vão para o projeto `imagine-up-app`. Os testes delas rodam nos emuladores do Firebase, que precisam de Java 21.

```bash
npm --prefix functions install  # dependências das Cloud Functions (uma vez)
npm run test:rules               # regras do Firestore no emulador
npm run test:functions           # Cloud Functions nos emuladores de Auth, Firestore e Functions
npm run emulators                # Firebase local para o app (com EXPO_PUBLIC_FIREBASE_EMULATOR_HOST no .env)
npm run emulators:seed           # contas de teste nos emuladores
npm run rules:deploy             # publica as regras
npm run functions:deploy         # publica as Cloud Functions (exige o plano Blaze)
```
