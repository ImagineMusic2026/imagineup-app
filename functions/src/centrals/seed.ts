import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { DEFAULT_POINTS_CONFIG } from '../points/config';
import { noonDaysAgo, SEED_ACTOR } from '../points/seed';
import { runJoinCentrals, type JoinOutcome } from './service';

// Centrais de teste no seed dos emuladores (scripts/seed-emulators.mjs, que
// carrega este build): as do protótipo, publicadas como o painel publicaria, e
// a Camila fã de Netto, Nenho e Juninho pelo mesmo caminho das rotas. Nunca
// roda em produção: o script fixa o emulador. docs/arquitetura-api.md, 19.14.

type SeedCentral = {
  id: string;
  name: string;
  shortName: string | null;
  order: number;
  status: 'draft' | 'published' | 'unpublished';
  verified: boolean;
  managedByImagine: boolean;
};

/**
 * Os @ batem com os pontos por central da carteira da Camila (`nettobrito` e
 * `nenho`, seção 14) e com os ids das fixtures do app. 6 publicadas (4 na grade
 * da 1l e 2 no "+2 artistas"), 1 rascunho e 1 fora do ar, que não aparecem.
 */
export const SEED_CENTRALS: readonly SeedCentral[] = [
  {
    id: 'nettobrito',
    name: 'Netto Brito',
    shortName: null,
    order: 0,
    status: 'published',
    verified: true,
    managedByImagine: true,
  },
  {
    id: 'nenho',
    name: 'Nenho',
    shortName: null,
    order: 1,
    status: 'published',
    verified: true,
    managedByImagine: true,
  },
  {
    id: 'juninhomoraes',
    name: 'Juninho Moraes',
    shortName: 'Juninho M.',
    order: 2,
    status: 'published',
    verified: true,
    managedByImagine: true,
  },
  {
    id: 'rocksalles',
    name: 'Rock Salles',
    shortName: null,
    order: 3,
    status: 'published',
    verified: true,
    managedByImagine: true,
  },
  {
    id: 'artista5',
    name: 'Artista 5',
    shortName: null,
    order: 4,
    status: 'published',
    verified: false,
    managedByImagine: false,
  },
  {
    id: 'artista6',
    name: 'Artista 6',
    shortName: null,
    order: 5,
    status: 'published',
    verified: false,
    managedByImagine: false,
  },
  {
    id: 'artista7',
    name: 'Artista 7',
    shortName: null,
    order: 6,
    status: 'draft',
    verified: false,
    managedByImagine: false,
  },
  {
    id: 'artista8',
    name: 'Artista 8',
    shortName: null,
    order: 7,
    status: 'unpublished',
    verified: false,
    managedByImagine: false,
  },
];

/** As centrais que a Camila segue no protótipo (1b, 1e), na ordem. */
export const CAMILA_CENTRALS = ['nettobrito', 'nenho', 'juninhomoraes'] as const;

/** A Camila entrou nelas antes da base da carteira (8 dias atrás). */
const CAMILA_JOINED_DAYS_AGO = 8;

/**
 * Cria cada central que ainda não existe, numa transação: artists/{id} no
 * formato do painel (sem foto: o placeholder pelo id, como nas fixtures),
 * artistPrivate/{id} e a reserva do @. A que já existe fica como o
 * desenvolvedor deixou no painel. Devolve quantas criou.
 */
export async function seedCentrals(db: Firestore, now: number = Date.now()): Promise<number> {
  const at = Timestamp.fromMillis(now);
  let created = 0;
  for (const central of SEED_CENTRALS) {
    const ref = db.collection('artists').doc(central.id);
    const reservationRef = db.collection('usernames').doc(central.id);
    created += await db.runTransaction(async (tx) => {
      const [artist, reservation] = await tx.getAll(ref, reservationRef);
      if (artist!.exists) return 0;
      tx.create(ref, {
        handle: central.id,
        name: central.name,
        shortName: central.shortName,
        genre: null,
        city: null,
        bio: null,
        verified: central.verified,
        photo: null,
        thumb: null,
        order: central.order,
        status: central.status,
        fanCount: 0,
        publishedAt: central.status === 'draft' ? null : at,
        createdAt: at,
        updatedAt: at,
        ...(central.managedByImagine ? { managedByImagine: true } : {}),
      });
      tx.create(db.collection('artistPrivate').doc(central.id), {
        email: null,
        phone: null,
        managerUid: null,
        managerName: null,
        imageRightsConfirmed: true,
        createdBy: 'seed',
        updatedBy: 'seed',
        updatedAt: at,
      });
      // O @ de uma fã que chegou antes fica com ela.
      if (!reservation!.exists) tx.create(reservationRef, { artistId: central.id, createdAt: at });
      return 1;
    });
  }
  return created;
}

/**
 * A Camila fã de Netto, Nenho e Juninho pelo mesmo readJoin e joinCentrals
 * das rotas (sem marcar atividade), com o `joinedAt` de 8 dias atrás e a
 * entrada valendo 0: a base da carteira (seção 14) já tem os pontos do
 * protótipo. Se ela sair e entrar de novo no app, ganha os 10. Rodar de novo
 * não muda nada.
 */
export async function seedCamilaCentrals(
  db: Firestore,
  uid: string,
  options: { now?: number } = {},
): Promise<JoinOutcome> {
  const now = options.now ?? Date.now();
  return runJoinCentrals(db, uid, CAMILA_CENTRALS, {
    now: noonDaysAgo(now, CAMILA_JOINED_DAYS_AGO),
    config: {
      ...DEFAULT_POINTS_CONFIG,
      values: { ...DEFAULT_POINTS_CONFIG.values, central_join: 0 },
    },
    actor: SEED_ACTOR,
    via: 'seed',
  });
}
