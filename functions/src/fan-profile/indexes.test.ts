import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// O emulador não exige índice nenhum: a tarefa das cópias do perfil (24.7) e
// a exclusão de conta (21.11) leem os comentários do fã pelo grupo
// `postComments` com `authorUid ==` (a tarefa, com a ordem pelo id). As duas
// dependem do escopo COLLECTION_GROUP ascendente na isenção de
// `postComments.authorUid` no firestore.indexes.json; sem ele, em produção, a
// consulta falha (24.10).

type FieldOverride = {
  collectionGroup: string;
  fieldPath: string;
  indexes: { order?: string; arrayConfig?: string; queryScope: string }[];
};

const indexes = JSON.parse(
  readFileSync(resolve(__dirname, '../../../firestore.indexes.json'), 'utf8'),
) as { fieldOverrides: FieldOverride[] };

describe('índice das cópias do perfil (24.10)', () => {
  it('a isenção de postComments.authorUid mantém o escopo COLLECTION_GROUP ascendente', () => {
    const override = indexes.fieldOverrides.find(
      (item) => item.collectionGroup === 'postComments' && item.fieldPath === 'authorUid',
    );
    expect(override).toBeDefined();
    expect(override!.indexes).toContainEqual({
      order: 'ASCENDING',
      queryScope: 'COLLECTION_GROUP',
    });
  });
});
