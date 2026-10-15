import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Projeto no expo.dev, na conta da cliente. O ID aparece na página do projeto
 * (Project ID). Enquanto estiver vazio, o EAS Update fica desligado e o
 * `eas build` pede para ligar o projeto.
 */
const EXPO_OWNER = 'imagineup-app';
const EXPO_SLUG = 'imagineup';
const EAS_PROJECT_ID = '6984e734-3efc-40bc-8b9b-4d65bffbe085';

const BUNDLE_ID = 'br.com.imaginegroup.imagineup';
const BACKGROUND_COLOR = '#0B0B10';

/**
 * ID do cliente iOS do Google: o CLIENT_ID do GoogleService-Info.plist do app
 * iOS no Firebase (33.9 de docs/arquitetura-api.md), e não o REVERSED_CLIENT_ID:
 * o esquema de volta sai deste. Não é segredo, porque vai dentro do app. Fica
 * vazio até o dono ligar o Google nos consoles. Vazio, o plugin do Google fica
 * de fora e o iOS fica sem o Google; o Android não usa o plugin. Preencher muda
 * o fingerprint: tem de ser antes da build das lojas.
 */
const GOOGLE_IOS_CLIENT_ID: string = '';

/** O formato do ID de um cliente do Google, o mesmo que o `src/config/env.ts` confere no do cliente Web. */
const GOOGLE_CLIENT_ID_PATTERN = /^[\w-]+\.apps\.googleusercontent\.com$/;

/**
 * O Google no iOS a partir do ID do cliente: o ID e o esquema que devolve o
 * Google ao app (o ID ao contrário), ou `null` com o ID vazio. Fora do formato
 * (o REVERSED_CLIENT_ID, `com.googleusercontent.apps...`, colado no lugar, ou um
 * espaço), lança, e o `expo config` e o `eas build` param: o prebuild passaria
 * calado, o botão apareceria no iOS com o esquema invertido duas vezes, e o
 * Google só falharia no TestFlight, com outra build para consertar.
 */
export function googleIosSignIn(clientId: string): { clientId: string; urlScheme: string } | null {
  if (!clientId) return null;
  if (!GOOGLE_CLIENT_ID_PATTERN.test(clientId)) {
    throw new Error(
      'GOOGLE_IOS_CLIENT_ID fora do formato <id>.apps.googleusercontent.com: use o CLIENT_ID do GoogleService-Info.plist, e não o REVERSED_CLIENT_ID.',
    );
  }
  return { clientId, urlScheme: clientId.split('.').reverse().join('.') };
}

const googleIos = googleIosSignIn(GOOGLE_IOS_CLIENT_ID);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'ImagineUP',
  slug: EXPO_SLUG,
  owner: EXPO_OWNER,
  version: '0.1.0',
  platforms: ['ios', 'android'],
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'imagineup',
  userInterfaceStyle: 'dark',
  backgroundColor: BACKGROUND_COLOR,
  // Cada mudança nativa gera um fingerprint novo, e um update só chega ao binário
  // com o mesmo fingerprint. Evita mandar JS para um nativo incompatível.
  runtimeVersion: { policy: 'fingerprint' },
  updates: EAS_PROJECT_ID
    ? {
        url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
        checkAutomatically: 'ON_LOAD',
        fallbackToCacheTimeout: 0,
      }
    : { enabled: false },
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    // Entrar com a Apple (seção 33 da nota): a capacidade no App ID.
    usesAppleSignIn: true,
    infoPlist: {
      CFBundleDevelopmentRegion: 'pt-BR',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: BACKGROUND_COLOR,
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // A foto do perfil sai do seletor do sistema, que não pede permissão de
    // mídia. A política de fotos e vídeos do Google Play recusa app com
    // READ_MEDIA_IMAGES ou READ_MEDIA_VIDEO sem ser de galeria: o bloqueio
    // tira as duas do manifesto final, venham de onde vierem (24.12 da nota).
    blockedPermissions: [
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
    ],
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: BACKGROUND_COLOR,
        image: './assets/images/splash-icon.png',
        imageWidth: 96,
      },
    ],
    // Foto do perfil (bloco 9): galeria ou câmera, sem microfone (sem RECORD_AUDIO
    // no Android). Na primeira build, conferir o manifesto final (24.12 da nota).
    [
      'expo-image-picker',
      {
        photosPermission: 'O ImagineUP usa suas fotos para a foto do seu perfil.',
        cameraPermission: 'O ImagineUP usa a câmera para a foto do seu perfil.',
        microphonePermission: false,
      },
    ],
    // Entrar com a Apple, só no iOS: o entitlement e o texto do botão no idioma do aparelho.
    'expo-apple-authentication',
    // Entrar com o Google sem os arquivos do Firebase: com o iosUrlScheme, o
    // plugin só põe o esquema de volta no Info.plist do iOS. Sem opções, ele
    // pede o google-services.json e o GoogleService-Info.plist, que o app não
    // usa. Por isso fica de fora até a constante ser preenchida.
    ...(googleIos
      ? [
          [
            '@react-native-google-signin/google-signin',
            { iosUrlScheme: googleIos.urlScheme },
          ] satisfies [string, { iosUrlScheme: string }],
        ]
      : []),
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    eas: EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : {},
    // O app lê pelo expo-constants. Ausente, o iOS fica sem o Google.
    ...(googleIos ? { googleIosClientId: googleIos.clientId } : {}),
  },
});
