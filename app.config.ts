import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withAndroidManifest } from 'expo/config-plugins';

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

const getAppConfig = ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'ImagineUP',
  slug: EXPO_SLUG,
  owner: EXPO_OWNER,
  version: '0.1.1',
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
    // Com o pacote instalado, o entitlement vem do plugin; esta chave só avisa
    // no prebuild se o pacote faltar.
    usesAppleSignIn: true,
    infoPlist: {
      CFBundleDevelopmentRegion: 'pt-BR',
      ITSAppUsesNonExemptEncryption: false,
      // Escrita como false de propósito (decisão do dono de 24/11/2026, 39.9 da
      // nota). O build 0.1.0 da loja não tem a chave, o que vale como false: a
      // interface do sistema dentro do app (o botão da Apple, o menu de editar
      // texto, as folhas do sistema) segue o idioma do app, o pt-BR do
      // CFBundleDevelopmentRegion, como o resto do app. Sem a chave, o plugin da
      // Apple a poria como true, e essa interface passaria ao idioma do aparelho
      // num iPhone fora do pt-BR. Vale para o app inteiro, e não só para a Apple.
      CFBundleAllowMixedLocalizations: false,
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
    // Entrar com a Apple (seção 39 da nota): o entitlement e o
    // CFBundleAllowMixedLocalizations, que aqui fica no false escrito acima. O
    // prebuild já o aplica sozinho com o pacote instalado; listado, fica
    // explícito. Tirar a Apple é tirar o pacote: um build iOS sem o entitlement
    // desligaria a capacidade no App ID (sincronização do eas build).
    'expo-apple-authentication',
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    eas: EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : {},
  },
});

export default (context: ConfigContext): ExpoConfig =>
  withAndroidManifest(getAppConfig(context), (config) => {
    const features = (config.modResults.manifest['uses-feature'] ??= []);
    const optionalFeatures = ['android.hardware.screen.portrait', 'android.hardware.wifi'];

    // O Google Play infere esses requisitos pela orientação e por ACCESS_WIFI_STATE.
    for (const name of optionalFeatures) {
      const declaration = features.find((feature) => feature.$['android:name'] === name);
      if (declaration) {
        declaration.$['android:required'] = 'false';
      } else {
        features.push({ $: { 'android:name': name, 'android:required': 'false' } });
      }
    }

    return config;
  });
