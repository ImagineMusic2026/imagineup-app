import { Alert } from 'react-native';

import { SUPPORT_EMAIL } from '@/config/links';
import { t } from '@/i18n';
import { dailyLimitKey, type RefusalAction, type RefusalType } from '@/services/api/refusal';
import { openSupportEmail } from '@/services/web-page';

/** As recusas que viram `Alert`: a conta suspensa e o teto do dia (29.1, decisões 19 e 20). */
export type AlertRefusal = 'suspended' | 'dailyLimit';

/** No máximo um `Alert` de cada tipo e ação nesse intervalo. */
export const REFUSAL_ALERT_LOCK_MS = 30_000;

const lastShown = new Map<string, number>();
/** Se a última recusa de cada tipo e ação abriu o `Alert` (falso: a trava segurou). */
const lastOpened = new Map<string, boolean>();

const lockOf = (type: AlertRefusal, action: RefusalAction | null) => `${type}:${action ?? ''}`;

/**
 * O único lugar que abre os `Alert` de recusa: "Conta suspensa" (com
 * "Escrever para a equipe") e "Limite de hoje" (a frase da ação). A trava de
 * 30 s por tipo e ação segura a fila offline que volta com várias ações
 * recusadas: dez curtidas no teto abririam dez `Alert`. O da conta suspensa
 * vem do `SuspensionWatcher`, sem ação (a mensagem é uma só). O relógio é
 * injetado no teste. Devolve se abriu.
 */
export function showRefusalAlert(type: 'suspended', action?: null, now?: number): boolean;
export function showRefusalAlert(type: 'dailyLimit', action: RefusalAction, now?: number): boolean;
export function showRefusalAlert(
  type: AlertRefusal,
  action: RefusalAction | null = null,
  now: number = Date.now(),
): boolean {
  const message =
    type === 'suspended'
      ? t('suspension.alertMessage', { email: SUPPORT_EMAIL })
      : action && t(dailyLimitKey(action));
  if (!message) return false;
  const lock = lockOf(type, action);
  const last = lastShown.get(lock);
  if (last !== undefined && now - last < REFUSAL_ALERT_LOCK_MS) {
    lastOpened.set(lock, false);
    return false;
  }
  lastShown.set(lock, now);
  lastOpened.set(lock, true);
  if (type === 'suspended') {
    Alert.alert(t('suspension.alertTitle'), message, [
      {
        text: t('suspension.contact'),
        onPress: () => void openSupportEmail(t('suspension.mailSubject')),
      },
      { text: t('suspension.alertOk'), style: 'cancel' },
    ]);
  } else {
    Alert.alert(t('errors.dailyLimitTitle'), message, [{ text: t('errors.ok'), style: 'cancel' }]);
  }
  return true;
}

/**
 * A recusa de uma ação sem texto na tela (curtir, "Eu vou" e entrar, no hook)
 * ficou com um `Alert`? O "Limite de hoje" abre aqui. O "Conta suspensa" já
 * abriu, ou não, no `SuspensionWatcher`: o `onError` do `MutationCache`, que
 * anota a recusa, roda antes do `onError` da mutação. Falso com a trava de
 * 30 s segurando o `Alert` (ou sem o watcher na árvore): o hook anuncia a
 * frase da recusa, senão o leitor de tela ficaria só com o anúncio otimista
 * ("Presença confirmada") de uma ação recusada. As defaults da fila não
 * anunciam: a fila que volta com dez recusas diria dez vezes a mesma frase.
 */
export function alertActionRefusal(type: RefusalType | null, action: RefusalAction): boolean {
  if (type === 'dailyLimit') return showRefusalAlert('dailyLimit', action);
  if (type === 'suspended') return lastOpened.get(lockOf('suspended', null)) === true;
  return false;
}

/** Solta as travas: o fim da sessão (o fã seguinte começa sem elas) e os testes. */
export function resetRefusalAlerts(): void {
  lastShown.clear();
  lastOpened.clear();
}
