import {
  FieldPath,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';

import { SOCIAL_NETWORKS } from './details';

// A carga que apaga o LinkedIn guardado nos perfis (seção 28 de
// docs/arquitetura-api.md): o LinkedIn saiu do app em 02/11/2026, a pedido do
// dono, e o usuário que o fã tinha posto não serve para mais nada. Roda por
// scripts/drop-linkedin-socials.mjs, depois do deploy das funções (antes
// dele, o servidor de antes ainda grava o LinkedIn que o app de antes manda).

/**
 * O mapa das redes sem o `linkedin` (puro): `undefined` quando não há o que
 * mudar (sem mapa ou sem a chave); null quando nenhuma das redes de agora
 * fica com texto (o mesmo null do `profileUpdateOf`); senão, o mapa sem a
 * chave, com o resto como estava.
 */
export function socialsWithoutLinkedin(value: unknown): Record<string, unknown> | null | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const map = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(map, 'linkedin')) return undefined;
  const rest = Object.fromEntries(Object.entries(map).filter(([key]) => key !== 'linkedin'));
  const hasText = SOCIAL_NETWORKS.some((network) => {
    const handle = rest[network];
    return typeof handle === 'string' && handle !== '';
  });
  return hasText ? rest : null;
}

/** Perfis lidos por página na carga. */
const PAGE = 500;

/** Perfis por transação na carga. */
const WRITE_CHUNK = 200;

async function* profilePages(db: Firestore): AsyncGenerator<DocumentSnapshot[]> {
  let last: DocumentSnapshot | null = null;
  for (;;) {
    let query = db
      .collection('users')
      .orderBy(FieldPath.documentId())
      .select('socials')
      .limit(PAGE);
    if (last) query = query.startAfter(last);
    const page = await query.get();
    yield page.docs;
    if (page.size < PAGE) return;
    last = page.docs.at(-1)!;
  }
}

const hasLinkedin = (doc: DocumentSnapshot) =>
  socialsWithoutLinkedin(doc.get('socials')) !== undefined;

export type LinkedinSocialsCount = { total: number; withLinkedin: number };

/** Quantos perfis há e quantos guardam o `linkedin` nas redes. Só lê. */
export async function countLinkedinSocials(db: Firestore): Promise<LinkedinSocialsCount> {
  let total = 0;
  let withLinkedin = 0;
  for await (const docs of profilePages(db)) {
    total += docs.length;
    withLinkedin += docs.filter(hasLinkedin).length;
  }
  return { total, withLinkedin };
}

/**
 * Tira o `linkedin` das redes dos perfis que o guardam, em transações de até
 * 200 perfis: cada uma relê os perfis (o fã pode ter salvo as redes no meio,
 * e o perfil que sumiu não é recriado) e grava só onde a chave ainda está, o
 * mapa inteiro (ou null), sem `updatedAt` e sem caminho com ponto, como o
 * `PUT /me/profile`. A gravação dispara o gatilho do perfil, que não olha as
 * redes e não faz nada. Rodar de novo não grava nada. Devolve quantos gravou.
 */
export async function dropLinkedinSocials(db: Firestore): Promise<number> {
  let written = 0;
  for await (const docs of profilePages(db)) {
    const refs = docs.filter(hasLinkedin).map((doc) => doc.ref);
    for (let start = 0; start < refs.length; start += WRITE_CHUNK) {
      written += await writeChunk(db, refs.slice(start, start + WRITE_CHUNK));
    }
  }
  return written;
}

function writeChunk(db: Firestore, refs: readonly DocumentReference[]): Promise<number> {
  return db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...refs);
    let count = 0;
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const next = socialsWithoutLinkedin(snap.get('socials'));
      if (next === undefined) continue;
      tx.update(snap.ref, { socials: next });
      count += 1;
    }
    return count;
  });
}
