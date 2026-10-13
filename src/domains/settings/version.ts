import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

import { formatDayMonth } from '@/utils/date';

/** Quantos caracteres do id do EAS Update aparecem: o bastante para achar o update no expo.dev. */
export const UPDATE_ID_LENGTH = 8;

/** O que a versão lê do app, injetado no teste. */
export interface VersionSources {
  /** `Constants.expoConfig.version`. */
  version: string | null | undefined;
  /** `Updates.isEmbeddedLaunch`: o JS que veio no binário, sem update baixado. */
  isEmbeddedLaunch: boolean;
  /** `Updates.createdAt` e `Updates.updateId`: `null` no Expo Go e no desenvolvimento. */
  createdAt: Date | null;
  updateId: string | null;
}

export interface AppVersionInfo {
  /** "0.1.0"; `null` sem a config do app. */
  version: string | null;
  /** O EAS Update que está rodando ("13 out" e "a1b2c3d4"); `null` no binário embutido e no Expo Go. */
  update: { date: string; id: string } | null;
}

/**
 * A versão dos Ajustes (seção 29, decisão 17): a do app e, fora do binário
 * embutido, a data e o id curto do EAS Update, que separam um JS do outro no
 * mesmo APK. Sem o número da build, que só sai pelo `expo-application`
 * (nativo).
 */
export function appVersionInfo(sources: VersionSources): AppVersionInfo {
  const { createdAt, updateId } = sources;
  const update =
    !sources.isEmbeddedLaunch && createdAt && updateId
      ? { date: formatDayMonth(createdAt), id: updateId.slice(0, UPDATE_ID_LENGTH) }
      : null;
  return { version: sources.version || null, update };
}

/** A versão do app que está rodando. */
export function readAppVersion(): AppVersionInfo {
  return appVersionInfo({
    version: Constants.expoConfig?.version,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    createdAt: Updates.createdAt,
    updateId: Updates.updateId,
  });
}
