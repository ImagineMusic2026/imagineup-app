import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

import { apiUrl } from '@/config/env';
import { getFirebaseAuth, isFirebaseConfigured } from '@/firebase';

import { toApiError } from './errors';

declare module 'axios' {
  interface AxiosRequestConfig {
    /**
     * O pedido só sai com o token desta conta: se a sessão do aparelho já for
     * de outra (outro fã entrou no meio), ele falha antes de sair, sem status,
     * como uma falha de rede. O convite amarrado a um uid usa (bloco 5): ele
     * nunca vai com o token de outro fã.
     */
    sessionUid?: string;
  }
}

type RetriableConfig = InternalAxiosRequestConfig & { _retriedAuth?: boolean };

/** A sessão do aparelho não é mais a conta que o pedido pediu (`sessionUid`). */
export class SessionChangedError extends Error {
  constructor() {
    super('A sessão mudou antes de o pedido sair.');
    this.name = 'SessionChangedError';
  }
}

/**
 * Cliente HTTP da API do app (Cloud Functions). Pontos, missões, resgates e tudo
 * que mexe em saldo passam pela API: o cliente nunca grava pontos direto.
 */
// eslint-disable-next-line import/no-named-as-default-member -- o axios não exporta `create` nomeado.
export const api = axios.create({
  baseURL: apiUrl,
  timeout: 15_000,
  headers: {
    Accept: 'application/json',
    'Accept-Language': 'pt-BR',
  },
});

async function currentIdToken(forceRefresh = false, sessionUid?: string): Promise<string | null> {
  if (!isFirebaseConfigured) return null;
  const auth = getFirebaseAuth();
  // O app pode abrir as abas antes do Firebase confirmar a sessão (dica de sessão
  // local); sem esperar, a primeira requisição sairia sem token.
  await auth.authStateReady();
  const user = auth.currentUser;
  if (sessionUid !== undefined && user?.uid !== sessionUid) throw new SessionChangedError();
  return user ? user.getIdToken(forceRefresh) : null;
}

api.interceptors.request.use(async (config) => {
  const token = await currentIdToken(false, config.sessionUid);
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined;
    // Token vencido: renova uma vez e repete a chamada.
    if (error.response?.status === 401 && config && !config._retriedAuth) {
      config._retriedAuth = true;
      let token: string | null;
      try {
        token = await currentIdToken(true, config.sessionUid);
      } catch (refreshError) {
        return Promise.reject(toApiError(refreshError));
      }
      if (token) {
        config.headers.set('Authorization', `Bearer ${token}`);
        return api.request(config);
      }
    }
    return Promise.reject(toApiError(error));
  },
);
