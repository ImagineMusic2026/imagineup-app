import {
  changeUsername,
  normalizeUsername,
  parseFanPhotoPath,
  parseProfileChanges,
  ProfileEditError,
  readUsernameAvailability,
  removeFanPhoto,
  reservePhotoUpload,
  setFanPhoto,
  updateFanProfile,
  USERNAME_INPUT_MAX,
  USERNAME_PATTERN,
} from '../../fan-profile';
import type {
  EditableProfile,
  PhotoChange,
  PhotoUploadSlot,
  ProfileChanges,
  UsernameAvailability,
  UsernameChange,
} from '../contract';
import { apiError } from '../errors';
import type { ApiRoute, RouteInput } from '../types';

// Rotas do perfil do fã. Desde o perfil novo (seção 28), toda a edição passa
// por aqui: o `PUT /me/profile` grava nome, @, bio, cidade, gênero, conta
// privada e redes num pedido só, com os tetos do dia, e as regras fecham a
// gravação direta (só o primeiro nome do perfil sem nome fica no cliente). Do
// bloco 9 ficam a disponibilidade do @ enquanto o fã digita, o
// `PUT /me/username` (o app novo não chama; fica para o APK de antes, com o
// mesmo núcleo) e a foto (conferir e gravar o arquivo que o app enviou ao
// Storage, ou tirar); desde a proteção contra abuso (27.4), também a vaga do
// envio, pedida antes de o app subir o arquivo. As que gravam rodam no
// runIdempotent, com o perfil exigido e lido na transação (o `profile` do
// contexto). docs/arquitetura-api.md, seções 24 e 28.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** O `username` cru (da busca ou do corpo): texto de até 64; senão 400 com o campo. */
function rawUsername(value: unknown): string {
  if (typeof value !== 'string' || value.length > USERNAME_INPUT_MAX) {
    throw apiError('invalid_request', { field: 'username' });
  }
  return value;
}

/** O @ do corpo do `PUT`, normalizado e no formato; fora do formato, 400 `username_invalid`. */
function bodyUsername(input: RouteInput): string {
  if (!isRecord(input.body)) throw apiError('invalid_request', { field: 'username' });
  const username = normalizeUsername(rawUsername(input.body.username));
  if (!USERNAME_PATTERN.test(username)) {
    throw new ProfileEditError('username_invalid', { reason: 'format' });
  }
  return username;
}

/**
 * O corpo do `PUT /me/profile` conferido e limpo (`parseProfileChanges`), sem
 * leitura: o malformado é 400 `invalid_request` com o campo, e o fora da regra
 * lança `profile_invalid` ou `username_invalid`.
 */
function bodyChanges(input: RouteInput): ProfileChanges {
  const parsed = parseProfileChanges(input.body);
  if (!parsed.ok) throw apiError('invalid_request', { field: parsed.field });
  return parsed.value;
}

/** O caminho do corpo do `PUT /me/photo`; fora do formato da pasta do fã, 400 `photo_invalid`. */
function bodyPath(input: RouteInput): string {
  if (!isRecord(input.body) || typeof input.body.path !== 'string') {
    throw apiError('invalid_request', { field: 'path' });
  }
  const { path } = input.body;
  if (!parseFanPhotoPath(path)) throw new ProfileEditError('photo_invalid', { reason: 'path' });
  return path;
}

export const profileRoutes: ApiRoute[] = [
  {
    // A edição inteira (seção 28): só o que mudou, numa transação. O suspenso
    // recebe 403 (sem `allowSuspended`); sem diferença, o perfil de agora,
    // sem gravar e sem contar no teto.
    method: 'PUT',
    pattern: '/me/profile',
    writes: true,
    validate: (input) => void bodyChanges(input),
    async handle(ctx) {
      const { body, plan } = await updateFanProfile(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        profile: ctx.profile,
        changes: bodyChanges(ctx),
      });
      const result: EditableProfile = body;
      return { body: result, plan };
    },
  },
  {
    // Enquanto o fã digita: só lê (0 ou 1 leitura), sem chave e sem exigir o perfil.
    method: 'GET',
    pattern: '/me/username/availability',
    writes: false,
    validate: (input) => void rawUsername(input.query.username),
    async handle({ deps, uid, query }): Promise<UsernameAvailability> {
      return readUsernameAvailability(deps.db, uid, rawUsername(query.username));
    },
  },
  {
    method: 'PUT',
    pattern: '/me/username',
    writes: true,
    validate: (input) => void bodyUsername(input),
    async handle(ctx) {
      const body: UsernameChange = await changeUsername(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        profile: ctx.profile,
        username: bodyUsername(ctx),
      });
      return { body };
    },
  },
  {
    // A vaga do arquivo que o app vai subir ao Storage (27.4): a regra do
    // Storage só aceita o envio com ela, e cada arquivo novo conta no teto do dia.
    method: 'POST',
    pattern: '/me/photo/upload',
    writes: true,
    validate: (input) => void bodyPath(input),
    async handle(ctx) {
      const { body, plan } = await reservePhotoUpload(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        path: bodyPath(ctx),
      });
      const result: PhotoUploadSlot = body;
      return { body: result, plan };
    },
  },
  {
    method: 'PUT',
    pattern: '/me/photo',
    writes: true,
    validate: (input) => void bodyPath(input),
    async handle(ctx) {
      const { body, plan } = await setFanPhoto(ctx.tx, ctx.deps.db, ctx.deps.files, {
        fan: ctx.fan,
        award: ctx.award,
        profile: ctx.profile,
        path: bodyPath(ctx),
      });
      const result: PhotoChange = body;
      return { body: result, plan };
    },
  },
  {
    // Remover nunca é recusado pelo teto; sem foto, a mesma resposta.
    method: 'DELETE',
    pattern: '/me/photo',
    writes: true,
    allowSuspended: true,
    async handle(ctx) {
      const body: PhotoChange = removeFanPhoto(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        profile: ctx.profile,
      });
      return { body };
    },
  },
];
