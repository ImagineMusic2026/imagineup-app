import {
  changeUsername,
  normalizeUsername,
  parseFanPhotoPath,
  ProfileEditError,
  readUsernameAvailability,
  removeFanPhoto,
  setFanPhoto,
  USERNAME_INPUT_MAX,
  USERNAME_PATTERN,
} from '../../fan-profile';
import type { PhotoChange, UsernameAvailability, UsernameChange } from '../contract';
import { apiError } from '../errors';
import type { ApiRoute, RouteInput } from '../types';

// Rotas do bloco 9: o @ escolhido pelo fã (a disponibilidade enquanto ele
// digita e a troca) e a foto do perfil (conferir e gravar o arquivo que o app
// enviou ao Storage, ou tirar). As três que gravam rodam no runIdempotent, com
// o perfil exigido e lido na transação (o `profile` do contexto). Nome e
// cidade não passam por aqui: o app grava direto no Firestore, pelas regras.
// docs/arquitetura-api.md, seção 24.

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
