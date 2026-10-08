import type { Firestore } from 'firebase-admin/firestore';

import { DEFAULT_POINTS_CONFIG } from '../points/config';
import { runAsFan } from '../points/award';
import type { PointsConfig } from '../points/model';
import { SEED_ACTOR } from '../points/seed';
import type { FanPhotoFiles } from './files';
import { setFanPhoto } from './service';

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
