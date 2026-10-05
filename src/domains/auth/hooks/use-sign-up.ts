import { useMutation } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';

import { bindPendingInvite, clearBoundInvite, type BoundInvite } from '@/domains/invites';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

import {
  authErrorMessageKey,
  fillMissingProfileName,
  isFinalInviteRejection,
  sendInviteClaim,
  signUpWithEmail,
  typedInviteRejection,
  waitForProfile,
  type InviteRejection,
} from '../api';
import { INVITE_CLAIM_WAIT_MS } from '../consts';
import type { SignUpForm } from '../schemas';
import { playAuthExit } from './use-auth-exit';

/** Como o cadastro terminou: seguiu, ou parou no código de convite recusado. */
export type SignUpOutcome =
  { status: 'done' } | { status: 'inviteRejected'; reason: InviteRejection };

// O fã que parou no estágio "código recusado" continua seguro nas telas de
// conta: a função que solta fica aqui, para o "Continuar" soltar depois.
let heldRelease: (() => void) | null = null;

/**
 * Solta o fã do estágio "código recusado" (uma vez; sem estágio, não faz
 * nada). Além do "Continuar", a tela de cadastro chama ao sair: se ela some no
 * estágio sem passar pelos botões, a trava não pode ficar, senão a conta, já
 * logada, segue presa nas telas de conta até o app reiniciar.
 */
export function releaseHeldSignUp(): void {
  const release = heldRelease;
  heldRelease = null;
  release?.();
}

/**
 * O claim do código digitado no cadastro, esperado por até 8 s:
 * - aceito: o convite sai do aparelho;
 * - recusado com o código que o fã conserta (404 ou 409): o convite sai e a
 *   recusa volta, para a tela pedir outro código;
 * - outra recusa definitiva: o convite sai e o cadastro segue;
 * - incerto (rede, servidor, o prazo): o convite fica amarrado, e a
 *   sincronização manda depois, com a mesma chave.
 */
async function claimTypedCode(bound: BoundInvite): Promise<InviteRejection | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), INVITE_CLAIM_WAIT_MS);
  });
  try {
    const result = await Promise.race([
      sendInviteClaim(bound).then(() => 'sent' as const),
      deadline,
    ]);
    if (result === 'sent') await clearBoundInvite(bound.uid, bound.idempotencyKey);
    return null;
  } catch (error) {
    if (!isFinalInviteRejection(error)) return null;
    await clearBoundInvite(bound.uid, bound.idempotencyKey);
    return typedInviteRejection(error);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cadastro por e-mail e senha:
 * 1. cria a conta e põe o nome nela logo em seguida (a função de cadastro lê
 *    o nome atual da conta para gerar o @);
 * 2. amarra o convite à conta nova (o do link guardado, ou o código
 *    digitado no campo do cadastro), ainda segurando o fã;
 * 3. espera o perfil (`users/{uid}`) nascer, com prazo; se ele nasceu sem
 *    nome (o nome chegou depois da espera da função), grava o nome da sessão
 *    nele, sem esperar a gravação;
 * 4. com o código digitado, espera o claim (até 8 s): recusado (não existe ou
 *    não vale), para no estágio "código recusado", ainda segurando o fã;
 * 5. apaga as telas de conta em fade e solta o fã. O convite do link vai pela
 *    sincronização (`useInviteSync`), assim que o fã é solto.
 *
 * A conta nasce logada no passo 1, e o guard tiraria a tela na hora: o
 * `holdAuth` segura o fã fora até o passo 5. Quem troca para a escolha de
 * artistas é o guard, quando ele solta.
 */
export function useSignUp() {
  return useMutation<SignUpOutcome, Error, SignUpForm>({
    mutationFn: async (form) => {
      releaseHeldSignUp();
      const release = useSessionStore.getState().holdAuth();
      let held = false;
      try {
        const user = await signUpWithEmail(form);
        // Conta nova nunca escolheu artistas, mesmo que outra conta já tenha
        // concluído a escolha neste aparelho (o "concluído" fica no aparelho).
        usePreferencesStore.getState().resetOnboarding();
        // O listener de sessão já pode ter gravado a conta sem nome; o nome
        // novo vale para as telas desde já.
        useSessionStore.getState().setSignedIn(user);
        // O convite fica preso a esta conta antes de qualquer espera: se o app
        // fechar daqui em diante, ele não vai para outra conta do aparelho.
        const bound = await bindPendingInvite(user.uid, form.inviteCode ?? '').catch(() => null);
        const profile = await waitForProfile(user.uid);
        // Sem await: a falha (ou a falta de rede) não segura nem derruba o cadastro.
        void fillMissingProfileName(user.uid, profile, user.displayName).catch((error: unknown) => {
          if (__DEV__) console.warn('[auth] O nome não foi para o perfil no cadastro.', error);
        });
        if (bound?.via === 'code') {
          const rejected = await claimTypedCode(bound);
          if (rejected) {
            held = true;
            heldRelease = release;
            return { status: 'inviteRejected', reason: rejected };
          }
        }
        haptics.trigger('success');
        await playAuthExit();
        return { status: 'done' };
      } finally {
        if (!held) release();
      }
    },
    onMutate: () => {
      AccessibilityInfo.announceForAccessibility(t('auth.signUp.creating'));
    },
    onError: (error) => {
      haptics.trigger('error');
      // O erro aparece embaixo do botão; o leitor de tela precisa ouvir também.
      AccessibilityInfo.announceForAccessibility(t(authErrorMessageKey(error, 'signUp')));
    },
    // Criar a conta não entra na fila offline: sem rede, o erro aparece na hora.
    networkMode: 'always',
    retry: false,
  });
}

/**
 * O "Continuar" do estágio "código recusado": a conta já existe. Com código,
 * amarra de novo (chave nova, porque a anterior foi recusada) e espera o
 * claim; recusado de novo, fica no estágio. Sem código ("Continuar sem
 * código"), ou com o claim aceito ou incerto, apaga as telas de conta em fade
 * e solta o fã.
 */
export function useFinishSignUp() {
  return useMutation<SignUpOutcome, Error, { inviteCode: string }>({
    mutationFn: async ({ inviteCode }) => {
      const uid = useSessionStore.getState().user?.uid ?? null;
      if (uid && inviteCode.trim()) {
        const bound = await bindPendingInvite(uid, inviteCode).catch(() => null);
        if (bound) {
          const rejected = await claimTypedCode(bound);
          if (rejected) return { status: 'inviteRejected', reason: rejected };
        }
      } else if (uid) {
        await clearBoundInvite(uid).catch(() => undefined);
      }
      haptics.trigger('success');
      await playAuthExit();
      releaseHeldSignUp();
      return { status: 'done' };
    },
    networkMode: 'always',
    retry: false,
  });
}
