import type { Firestore } from 'firebase-admin/firestore';

import { DEFAULT_POINTS_CONFIG } from '../points/config';
import { NO_GAME } from '../points/model';
import { SEED_ACTOR } from '../points/seed';
import { applicationRecord, type ApplicationInput } from './model';
import { runFanClubDecision } from './panel';
import { runApplyForFanClub } from './service';
import { applicationRef } from './store';

// O fã-clube no seed dos emuladores (docs/arquitetura-api.md, 34.12), na
// etapa 1 de 34.14: a Camila, gestora aprovada do fã-clube do Netto, pelos
// núcleos de verdade (a candidatura com o ator de sistema, que não conta no
// teto, e a aprovação com o admin do seed), e o Nenho com o `photosAllowed:
// false` gravado (os fã-clubes dele só publicam texto). O Netto fica com as
// caixas pelo padrão (o `imageRightsConfirmed`). As publicações, os
// seguidores, a denúncia, o prêmio e a candidatura pendente da Duda chegam
// com as etapas deles. Rodar de novo não muda nada. Nunca roda em produção:
// o script fixa os emuladores.

/** A central com as fotos de fã desligadas (só texto). */
export const SEED_TEXT_ONLY_ARTIST = 'nenho';

/** A candidatura da Camila (as redes de exemplo do perfil dela, 28.10). */
export const SEED_CAMILA_FAN_CLUB: ApplicationInput = {
  artistId: 'nettobrito',
  name: 'Netto de Coração',
  instagram: 'camila.teste.up',
  tiktok: 'camila.teste.up',
  pitch:
    'Divulgo o Netto nos stories e no grupo dos fãs de Irará, levo a turma aos shows e ' +
    'compartilho os clipes no dia do lançamento.',
};

export type SeedFanClubsResult = {
  /** O Nenho ganhou o `photosAllowed: false` agora. */
  textOnly: boolean;
  /** A candidatura da Camila entrou agora. */
  applied: boolean;
  /** A candidatura da Camila foi aprovada agora. */
  approved: boolean;
};

/**
 * O seed do fã-clube: o Nenho só com texto e a Camila aprovada. Cada passo só
 * roda quando o que ele cria ainda não existe: a candidatura só nasce sem
 * nenhuma, e a aprovação só vai com ela pendente (a recusada ou retirada no
 * painel local fica como está).
 */
export async function seedFanClubs(
  db: Firestore,
  camilaUid: string,
  actor: { uid: string; name: string },
  now: number = Date.now(),
): Promise<SeedFanClubsResult> {
  const result: SeedFanClubsResult = { textOnly: false, applied: false, approved: false };
  const textOnly = db.collection('artistPrivate').doc(SEED_TEXT_ONLY_ARTIST);
  const privateDoc = await textOnly.get();
  if (!privateDoc.exists) throw new Error(`Falta a central ${SEED_TEXT_ONLY_ARTIST} do seed.`);
  if (privateDoc.get('fanClubs.photosAllowed') !== false) {
    await textOnly.set({ fanClubs: { photosAllowed: false } }, { merge: true });
    result.textOnly = true;
  }

  const options = { now, config: DEFAULT_POINTS_CONFIG, actor: SEED_ACTOR, game: NO_GAME };
  let application = await applicationRef(db, camilaUid).get();
  if (!application.exists) {
    await runApplyForFanClub(db, camilaUid, SEED_CAMILA_FAN_CLUB, options);
    result.applied = true;
    application = await applicationRef(db, camilaUid).get();
  }
  const record = applicationRecord(camilaUid, application.data() ?? {});
  if (record.status === 'pending') {
    await runFanClubDecision(
      db,
      {
        subject: 'application',
        id: camilaUid,
        decision: 'approve',
        expected: record.round,
        name: null,
      },
      { actor, now },
    );
    result.approved = true;
  }
  return result;
}
