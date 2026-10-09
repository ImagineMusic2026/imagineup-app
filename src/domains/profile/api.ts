import { doc, getDoc, onSnapshot, type DocumentData } from 'firebase/firestore';

import { sourceOf } from '@/config/data-source';
import { getDb, storageFileExists, uploadLocalFile } from '@/firebase';
import { api } from '@/services/api';
import type { InviteLinkResult } from '@/domains/invites';
import { fixtureDelay, fixtureNow } from '@/services/fixtures';

import { genderOf, socialsOf } from './details';
import { fanProfileFixture } from './fan-fixtures';
import {
  buildLedgerPageFixture,
  buildMyAchievementsFixture,
  buildMyInviteFixture,
  buildMyProgressFixture,
  buildWalletFixture,
} from './fixtures';
import type {
  EditableProfile,
  FanProfile,
  FanPublicProfile,
  LedgerPage,
  MyAchievements,
  MyInvite,
  MyProgress,
  PhotoChange,
  PhotoUploadSlot,
  ProfileChanges,
  UsernameAvailability,
  Wallet,
} from './types';

// Chamadas cruas ao Firestore e à API. Sem React: quem cacheia é o queries.ts.
// O Firestore aqui só lê: toda a edição do perfil vai pela API (seção 28).

function profileRef(uid: string) {
  return doc(getDb(), 'users', uid);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function hasToDate(value: unknown): value is { toDate: () => Date } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof value.toDate === 'function'
  );
}

/** `Timestamp` do Firestore (ou ISO, se já vier assim) para ISO; o resto vira `null`. */
function isoOrNull(value: unknown): string | null {
  const date = hasToDate(value)
    ? value.toDate()
    : typeof value === 'string'
      ? new Date(value)
      : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

/**
 * O documento como o app usa. Só os campos conhecidos, cada um conferido: um
 * valor do servidor fora do formato vira `null` em vez de quebrar a tela, e o
 * `Timestamp` vira ISO, porque o cache do React Query vai para o disco em JSON.
 * Os campos do perfil novo (seção 28): a bio texto ou `null`, o gênero só dos
 * quatro valores, a conta privada só booleano (o ausente vale `false`) e as
 * redes rede a rede pela lista fixa, com a fora do padrão como vazia.
 */
export function toFanProfile(uid: string, data: DocumentData): FanProfile {
  // A suspensão (bloco 11) só aparece quando existe: o perfil de sempre fica igual.
  const suspendedAt = isoOrNull(data.suspendedAt);
  return {
    uid,
    displayName: textOrNull(data.displayName),
    username: textOrNull(data.username),
    city: textOrNull(data.city),
    photoURL: textOrNull(data.photoURL),
    createdAt: isoOrNull(data.createdAt),
    usernameChangeableAt: isoOrNull(data.usernameChangeableAt),
    bio: textOrNull(data.bio),
    gender: genderOf(data.gender),
    privateAccount: data.privateAccount === true,
    socials: socialsOf(data.socials),
    ...(suspendedAt ? { suspendedAt } : {}),
  };
}

/**
 * A resposta do `PUT /me/profile` como o perfil em cache guarda, com a mesma
 * conferência da leitura do Firestore (as redes pela lista fixa). Os campos
 * que a resposta não traz (foto, cadastro, suspensão) ficam como estão.
 */
export function applyEditableProfile(profile: FanProfile, edited: EditableProfile): FanProfile {
  return {
    ...profile,
    displayName: textOrNull(edited.displayName),
    username: textOrNull(edited.username),
    usernameChangeableAt: isoOrNull(edited.usernameChangeableAt),
    bio: textOrNull(edited.bio),
    city: textOrNull(edited.city),
    gender: genderOf(edited.gender),
    privateAccount: edited.privateAccount === true,
    socials: socialsOf(edited.socials),
  };
}

/**
 * O perfil do fã logado. `null` enquanto a função de cadastro ainda não o
 * criou (leva alguns segundos): a tela trata como carregando.
 */
export async function fetchMyProfile(uid: string): Promise<FanProfile | null> {
  const snapshot = await getDoc(profileRef(uid));
  return snapshot.exists() ? toFanProfile(uid, snapshot.data()) : null;
}

/**
 * Avisa a cada mudança do perfil (ele nasce depois do cadastro, e a foto é
 * gravada pelo servidor depois). Devolve a função que desliga.
 *
 * Sem rede, o SDK dispara a escuta com o que tem no cache dele, que no React
 * Native fica só na memória: na abertura a frio, o documento chega "ausente"
 * sem estar. Esse aviso é ignorado, para não apagar o perfil salvo no cache do
 * app; "não existe" só vale quando vem do servidor.
 */
export function watchMyProfile(
  uid: string,
  onChange: (profile: FanProfile | null) => void,
  onError: (error: Error) => void = () => undefined,
): () => void {
  return onSnapshot(
    profileRef(uid),
    (snapshot) => {
      if (!snapshot.exists() && snapshot.metadata.fromCache) return;
      onChange(snapshot.exists() ? toFanProfile(uid, snapshot.data()) : null);
    },
    onError,
  );
}

/** Saldo, nível e temporada. Só o servidor grava; o app só lê. */
export async function fetchWallet(): Promise<Wallet> {
  if (sourceOf('wallet') === 'fixtures') {
    await fixtureDelay();
    return buildWalletFixture();
  }
  const { data } = await api.get<Wallet>('/me/wallet');
  return data;
}

/** Nível (com o XP que nunca cai), ganhos da semana e números do fã (1e). */
export async function fetchMyProgress(): Promise<MyProgress> {
  if (sourceOf('wallet') === 'fixtures') {
    await fixtureDelay();
    return buildMyProgressFixture();
  }
  const { data } = await api.get<MyProgress>('/me/progress');
  return data;
}

/**
 * Uma página do extrato de pontos (`GET /me/ledger`, do bloco 1, com o nome da
 * central e o título da missão desde o bloco 7), da mesma fonte da carteira.
 */
export async function fetchLedgerPage({ cursor }: { cursor: string | null }): Promise<LedgerPage> {
  if (sourceOf('wallet') === 'fixtures') {
    await fixtureDelay();
    return buildLedgerPageFixture(fixtureNow(), cursor);
  }
  const { data } = await api.get<LedgerPage>('/me/ledger', {
    params: cursor ? { cursor } : undefined,
  });
  return data;
}

/** Contagem de conquistas e as que o perfil mostra. */
export async function fetchMyAchievements(): Promise<MyAchievements> {
  if (sourceOf('achievements') === 'fixtures') {
    await fixtureDelay();
    return buildMyAchievementsFixture(fixtureNow());
  }
  const { data } = await api.get<MyAchievements>('/me/achievements');
  return data;
}

/**
 * Código de convite do fã e o que cada pessoa trazida rende. Na API, o
 * código nasce na primeira chamada e nunca muda.
 */
export async function fetchMyInvite(): Promise<MyInvite> {
  if (sourceOf('invite') === 'fixtures') {
    await fixtureDelay();
    return buildMyInviteFixture();
  }
  const { data } = await api.get<MyInvite>('/me/invite');
  return data;
}

/**
 * Conta o link que o fã compartilhou ("links criados" do Perfil): um por
 * destino (`invite`, `agenda`, `post:<id>`, `artist:<id>`). Nas fixtures,
 * não chama nada: nas builds há o código de exemplo, e o `PUT` sairia com o
 * endereço da API vazio; os links de exemplo não mudam.
 */
export async function registerInviteLink(
  linkId: string,
  idempotencyKey: string,
): Promise<InviteLinkResult> {
  if (sourceOf('invite') === 'fixtures') return { linkId, created: false };
  const { data } = await api.put<InviteLinkResult>(
    `/me/invite/links/${encodeURIComponent(linkId)}`,
    undefined,
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  return data;
}

// --- Perfil editável (bloco 9 e seção 28 de docs/arquitetura-api.md) -------------

/**
 * O perfil só muda com a API (`sourceOf('profile')`): nas fixtures, a tela
 * fica só leitura e não chama estas funções; se chamar, é erro, e não uma
 * imitação (o perfil é dado de verdade, 24.1, decisão 12, e as regras não
 * deixam o fã gravar o perfil direto, 28.8).
 */
function requireProfileApi(): void {
  if (sourceOf('profile') === 'fixtures') {
    throw new Error('O perfil só muda com a API do servidor.');
  }
}

/**
 * Salva o perfil (`PUT /me/profile`, seção 28): só o que mudou, nome, @, bio,
 * cidade, gênero, conta privada e redes numa transação (tudo grava ou nada
 * grava), com a chave da tentativa. O `signal` é o prazo da tentativa do ✓
 * (cancela o pedido). Devolve o perfil editável depois da mudança.
 */
export async function updateMyProfile(
  changes: ProfileChanges,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<EditableProfile> {
  requireProfileApi();
  const { data } = await api.put<EditableProfile>('/me/profile', changes, {
    headers: { 'Idempotency-Key': idempotencyKey },
    signal,
  });
  return data;
}

/** O @ está livre? Enquanto o fã digita (só lê, sem chave). */
export async function fetchUsernameAvailability(username: string): Promise<UsernameAvailability> {
  requireProfileApi();
  const { data } = await api.get<UsernameAvailability>('/me/username/availability', {
    params: { username },
  });
  return data;
}

/** O caminho da foto no Storage: a pasta do fã e o id da tentativa. */
export const fanPhotoPath = (uid: string, id: string): string => `fans/${uid}/photo-${id}.jpg`;

/**
 * Abre a vaga do envio (`POST /me/photo/upload`): a regra do Storage só aceita
 * o arquivo com a vaga aberta pela API, e cada arquivo novo conta no teto do
 * dia. A chave é de cada chamada, e não da tentativa: pedir de novo a vaga do
 * mesmo arquivo renova o prazo sem contar, e a resposta guardada de uma chave
 * repetida traria o prazo antigo.
 */
export async function reservePhotoUpload(
  path: string,
  idempotencyKey: string,
): Promise<PhotoUploadSlot> {
  requireProfileApi();
  const { data } = await api.post<PhotoUploadSlot>(
    '/me/photo/upload',
    { path },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  return data;
}

/** Envia a foto preparada (JPEG) para a pasta do fã e devolve o caminho. */
export async function uploadFanPhoto(uid: string, localUri: string, id: string): Promise<string> {
  requireProfileApi();
  const path = fanPhotoPath(uid, id);
  await uploadLocalFile(path, localUri, 'image/jpeg');
  return path;
}

/** O envio desta tentativa já chegou ao Storage? (Os metadados, que a regra deixa o dono ler.) */
export function photoUploaded(path: string): Promise<boolean> {
  requireProfileApi();
  return storageFileExists(path);
}

/** A API confere o arquivo enviado e grava a foto (`PUT /me/photo`). */
export async function setMyPhoto(path: string, idempotencyKey: string): Promise<PhotoChange> {
  requireProfileApi();
  const { data } = await api.put<PhotoChange>(
    '/me/photo',
    { path },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  return data;
}

/** Tira a foto do perfil (`DELETE /me/photo`). */
export async function removeMyPhoto(idempotencyKey: string): Promise<PhotoChange> {
  requireProfileApi();
  const { data } = await api.delete<PhotoChange>('/me/photo', {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return data;
}

// --- Perfil público de outro fã (seção 28) ----------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A resposta do `GET /fans/:fanId` como a tela usa, com a mesma conferência
 * do perfil do Firestore: cada campo conferido, e as redes lidas pela lista
 * fixa, com a rede fora do padrão descartada (quem mostra nunca monta o link
 * de um valor torto, 28.1, decisão 4). O fechado nunca traz a bio nem as redes.
 */
export function toFanPublicProfile(fanId: string, data: unknown): FanPublicProfile {
  const body = isRecord(data) ? data : {};
  const restricted = body.restricted === true;
  return {
    uid: textOrNull(body.uid) ?? fanId,
    displayName: textOrNull(body.displayName),
    username: textOrNull(body.username),
    photoURL: textOrNull(body.photoURL),
    restricted,
    bio: restricted ? null : textOrNull(body.bio),
    socials: restricted ? null : socialsOf(body.socials),
  };
}

/**
 * O perfil público de outro fã (`GET /fans/:fanId`): a foto, o nome e o @, e a
 * bio e as redes quando ele não está fechado. Só lê. Nas fixtures, o perfil de
 * exemplo do ranking e dos comentários (`fan-fixtures.ts`); o 404
 * `fan_not_found` nos dois.
 */
export async function fetchFanProfile(fanId: string): Promise<FanPublicProfile> {
  if (sourceOf('profile') === 'fixtures') {
    return toFanPublicProfile(fanId, await fanProfileFixture(fanId));
  }
  const { data } = await api.get<unknown>(`/fans/${encodeURIComponent(fanId)}`);
  return toFanPublicProfile(fanId, data);
}
