import type { Firestore } from 'firebase-admin/firestore';

import { DEFAULT_POINTS_CONFIG } from '../points/config';
import { runAsFan } from '../points/award';
import type { PointsConfig } from '../points/model';
import { SEED_ACTOR } from '../points/seed';
import {
  hasProfileChanges,
  parseProfileChanges,
  profileDiff,
  type FanSocials,
  type Gender,
  type ProfileChanges,
} from './details';
import type { FanPhotoFiles } from './files';
import { setFanPhoto, updateFanProfile } from './service';

// A foto de teste da Camila no seed dos emuladores (bloco 9, 24.13), e a do
// fã de propaganda da Moderação (bloco 11, 26.13): uma imagem abstrata da
// marca (scripts/seed-assets/foto-teste.jpg, sem rosto e sem texto), enviada
// pelo Admin SDK e gravada pelo mesmo núcleo da rota (`setFanPhoto`), com o
// ator de sistema (que não conta no teto do dia). Nunca roda em produção: o
// script fixa os emuladores.

/** O nome do arquivo da foto do seed (no formato que a regra e a rota aceitam). */
export const SEED_PHOTO_FILE = 'photo-seed-camila.jpg';

/** O arquivo da foto do fã de propaganda (bloco 11). */
export const SEED_SPAM_PHOTO_FILE = 'photo-seed-spam.jpg';

/** Sobe os bytes para o caminho, como `image/jpeg` (o emulador dá o token de download). */
export type UploadPhoto = (path: string, bytes: Uint8Array) => Promise<void>;

/**
 * Dá ao fã a foto de teste. Com `photoPath` no perfil, não faz nada (rodar de
 * novo não muda nada). O "agora" é o de verdade: o arquivo acabou de subir, e
 * a rota recusa o de mais de 10 min.
 */
export async function seedFanPhoto(
  db: Firestore,
  files: FanPhotoFiles,
  upload: UploadPhoto,
  uid: string,
  bytes: Uint8Array,
  options: { config?: PointsConfig; now?: () => number; fileName?: string } = {},
): Promise<'created' | 'exists'> {
  const profile = await db.collection('users').doc(uid).get();
  if (!profile.exists) throw new Error(`O fã ${uid} não tem perfil.`);
  if (typeof profile.get('photoPath') === 'string') return 'exists';
  const path = `fans/${uid}/${options.fileName ?? SEED_PHOTO_FILE}`;
  await upload(path, bytes);
  await runAsFan(
    db,
    uid,
    {
      now: (options.now ?? Date.now)(),
      config: options.config ?? DEFAULT_POINTS_CONFIG,
      actor: SEED_ACTOR,
    },
    (tx, fan, award, snapshot) =>
      setFanPhoto(tx, db, files, { fan, award, profile: snapshot, path }),
  );
  return 'created';
}

// --- Perfil novo (seção 28, 28.10) ---------------------------------------------

/** Um fã de teste do seed dos emuladores (a senha fica no script, por e-mail). */
export type SeedFan = {
  email: string;
  displayName: string;
  /** A cidade gravada depois do cadastro; null fica sem cidade. */
  city: string | null;
  /** A Camila: a carteira do protótipo, as centrais, o convite e a loja. */
  wallet?: true;
  /** Convidada pela Camila (a origem de cada uma está no `SEED_INVITEES`). */
  invited?: true;
};

/**
 * Os fãs de teste do `scripts/seed-emulators.mjs` (antes uma lista do
 * próprio script): o script importa do build, e o teste do seed lê os nomes
 * sem rodar o script, que cria contas no import. As 48 contas do ranking
 * ficam no `RANKING_SEED`.
 */
export const SEED_FANS: readonly SeedFan[] = [
  {
    email: 'camila@teste.imagineup',
    displayName: 'Camila Ribeiro',
    city: 'Feira de Santana, BA',
    wallet: true,
  },
  { email: 'alan@teste.imagineup', displayName: 'Alan Ferreira', city: 'Irará, BA' },
  { email: 'bia@teste.imagineup', displayName: 'Bia Santos', city: 'Salvador, BA', invited: true },
  {
    email: 'duda@teste.imagineup',
    displayName: 'Duda Lima',
    city: 'Alagoinhas, BA',
    invited: true,
  },
  {
    email: 'enzo@teste.imagineup',
    displayName: 'Enzo Rocha',
    city: 'Santo Amaro, BA',
    invited: true,
  },
  // Só visita o link do clipe da Camila (bloco 7): anda o "Leve 5 pessoas".
  { email: 'gabi@teste.imagineup', displayName: 'Gabi Souza', city: 'Cruz das Almas, BA' },
  // O fã de propaganda da Moderação (bloco 11): foto, três comentários no
  // clipe, denunciados pela Bia e pela Duda, e a bio de propaganda. Sem cidade.
  { email: 'spam@teste.imagineup', displayName: 'Promo Seguidores', city: null },
];

/** Os detalhes do perfil novo de um fã de teste (28.10). */
export type SeedFanDetails = {
  email: string;
  /** O nome do perfil (o do cadastro). */
  displayName: string;
  /** O @ que o cadastro dá no emulador (o `usernameBase` do nome; o seed não troca). */
  username: string;
  bio: string | null;
  gender: Gender | null;
  privateAccount: boolean;
  /** Só as redes preenchidas; as outras ficam vazias. */
  socials: Partial<FanSocials>;
};

/**
 * A tabela de 28.10, por e-mail: a Camila (o fã), a Bia e o Promo (que
 * comentam no seed: a entrada pelo comentário e a bio de propaganda que a
 * Moderação apaga), a Thalita (o 1º do pódio, completa e com gênero, para o
 * teste provar que ele não sai) e a Aline (privada, com bio e redes, para
 * provar que não saem). A Renata (`rank-48`, suspensa) e os outros ficam sem
 * detalhes. Os usuários das redes levam "teste" e "up", mas qualquer pessoa
 * pode registrá-los: nas fixtures e no emulador, os links não abrem.
 */
export const SEED_FAN_DETAILS: readonly SeedFanDetails[] = [
  {
    email: 'camila@teste.imagineup',
    displayName: 'Camila Ribeiro',
    username: 'camilarib',
    bio: 'Feira de Santana.\nFã do Netto desde o primeiro show.',
    gender: 'woman',
    privateAccount: false,
    socials: {
      instagram: 'camila.teste.up',
      tiktok: 'camila.teste.up',
      linkedin: 'camila-teste-imagineup',
      x: 'camilatesteup',
    },
  },
  {
    email: 'bia@teste.imagineup',
    displayName: 'Bia Santos',
    username: 'biasan',
    bio: 'Salvador.\nMando todo clipe novo para o grupo da família.',
    gender: 'woman',
    privateAccount: false,
    socials: { instagram: 'bia.teste.up', tiktok: 'bia.teste.up' },
  },
  {
    email: 'spam@teste.imagineup',
    displayName: 'Promo Seguidores',
    username: 'promoseg',
    bio: 'Seguidores reais e baratos! Chama no direct.',
    gender: null,
    privateAccount: false,
    socials: { instagram: 'promo.teste.up', x: 'promotesteup' },
  },
  {
    email: 'rank-01@teste.imagineup',
    displayName: 'Thalita Santos',
    username: 'thalitasan',
    bio: 'Do arrocha ao piseiro, sigo o Netto em todo São João.\nIrará na veia.',
    gender: 'woman',
    privateAccount: false,
    socials: {
      instagram: 'thalita.teste.up',
      tiktok: 'thalita.teste.up',
      linkedin: 'thalita-teste-imagineup',
      x: 'thalitatesteup',
    },
  },
  {
    email: 'rank-05@teste.imagineup',
    displayName: 'Aline Ferreira',
    username: 'alinefer',
    bio: 'Conta de teste privada. Esta bio não aparece para os outros fãs.',
    gender: 'undisclosed',
    privateAccount: true,
    socials: { instagram: 'aline.teste.up', x: 'alinetesteup' },
  },
];

/** O corpo do `PUT /me/profile` com os detalhes de um fã de teste (sem redes, sem `socials`). */
export function seedFanDetailsChanges(details: SeedFanDetails): ProfileChanges {
  return {
    bio: details.bio,
    gender: details.gender,
    privateAccount: details.privateAccount,
    ...(Object.keys(details.socials).length > 0 ? { socials: details.socials } : {}),
  };
}

/**
 * Grava os detalhes do perfil novo de um fã de teste pelo mesmo caminho da
 * rota: o corpo passa pelo `parseProfileChanges` (o que a rota recusaria, o
 * seed recusa) e grava pelo `updateFanProfile` no `runAsFan`, com o ator de
 * sistema (os tetos do dia não contam, e o plano vazio não grava a carteira).
 * Rodar de novo não grava: sem diferença, `'unchanged'`.
 */
export async function seedFanDetails(
  db: Firestore,
  uid: string,
  changes: ProfileChanges,
  options: { config?: PointsConfig; now?: number } = {},
): Promise<'written' | 'unchanged'> {
  const parsed = parseProfileChanges(changes);
  if (!parsed.ok) throw new Error(`Detalhes do seed fora do formato: ${parsed.field}.`);
  const outcome = await runAsFan(
    db,
    uid,
    {
      now: options.now ?? Date.now(),
      config: options.config ?? DEFAULT_POINTS_CONFIG,
      actor: SEED_ACTOR,
    },
    async (tx, fan, award, profile) => {
      const changed = hasProfileChanges(
        profileDiff((profile.data() ?? {}) as Record<string, unknown>, parsed.value),
      );
      const { plan } = await updateFanProfile(tx, db, {
        fan,
        award,
        profile,
        changes: parsed.value,
      });
      return { plan, changed };
    },
  );
  return outcome.changed ? 'written' : 'unchanged';
}
