import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

import { apiUrl } from '@/config/env';
import { getFirebaseAuth, isFirebaseConfigured } from '@/services/firebase';

import { toApiError } from './errors';

type RetriableConfig = InternalAxiosRequestConfig & { _retriedAuth?: boolean };

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

async function currentIdToken(forceRefresh = false): Promise<string | null> {
  if (!isFirebaseConfigured) return null;
  const user = getFirebaseAuth().currentUser;
  return user ? user.getIdToken(forceRefresh) : null;
}

api.interceptors.request.use(async (config) => {
  const token = await currentIdToken();
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
      const token = await currentIdToken(true);
      if (token) {
        config.headers.set('Authorization', `Bearer ${token}`);
        return api.request(config);
      }
    }
    return Promise.reject(toApiError(error));
  },
);
