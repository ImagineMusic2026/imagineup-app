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
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    eas: EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : {},
  },
});
