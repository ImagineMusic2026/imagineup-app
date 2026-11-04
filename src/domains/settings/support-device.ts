import { Platform } from 'react-native';

import type { SupportDevice } from '@/domains/support';

import { readAppVersion } from './version';

/** O teto de cada texto do aparelho no servidor (`DEVICE_FIELD_MAX`, seção 38). */
const DEVICE_FIELD_MAX = 40;

/** O que o aparelho do problema lê do app, injetado no teste. */
export interface DeviceSources {
  /** `Platform.OS`. */
  os: string;
  /** A versão do sistema: no Android, a do `Platform.constants.Release` ("14"); no iOS, a do `Platform.Version`. */
  osVersion: string | number | null | undefined;
  /** A do app ("0.1.0"). */
  appVersion: string | null;
  /** O id curto do EAS Update, fora do binário embutido. */
  updateId: string | null;
}

/** Um texto do aparelho: sem espaço nas pontas, até 40 caracteres, ou `null`. */
function field(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().slice(0, DEVICE_FIELD_MAX);
  return text === '' ? null : text;
}

/**
 * O aparelho que vai junto do "Reportar problema" (seção 38, decisão 4): o
 * sistema, a versão dele, a do app e o id do update, sem nada que identifique
 * a pessoa e sem pacote nativo (o modelo do celular pediria o `expo-device`).
 * Fora do Android e do iOS, `null`.
 */
export function supportDeviceOf(sources: DeviceSources): SupportDevice | null {
  if (sources.os !== 'android' && sources.os !== 'ios') return null;
  return {
    platform: sources.os,
    osVersion: field(sources.osVersion),
    appVersion: field(sources.appVersion),
    updateId: field(sources.updateId),
  };
}

/** O aparelho que está rodando o app. */
export function readSupportDevice(): SupportDevice | null {
  const { version, update } = readAppVersion();
  const constants = Platform.constants as { Release?: string } | undefined;
  return supportDeviceOf({
    os: Platform.OS,
    osVersion:
      Platform.OS === 'android' ? (constants?.Release ?? Platform.Version) : Platform.Version,
    appVersion: version,
    updateId: update?.id ?? null,
  });
}
