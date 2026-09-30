import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { staffErrorReason } from './errors';
import {
  accessFor,
  INVITE_TTL_MS,
  inviteExpiry,
  inviteState,
  inviteUrl,
  isActiveAdmin,
  isActiveMember,
  leavesNoActiveAdmin,
  parseAccess,
  parseEmail,
  parseInviteId,
  parseName,
  parseOptionalName,
  parsePassword,
  parseRole,
  parseSections,
  parseUid,
  requestFields,
  ROLE_LABELS,
  sectionAccess,
  SECTION_IDS,
  sessionAllowed,
} from './model';

/** Motivo (details.reason) do erro que a função lança. */
function reasonOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return staffErrorReason(error);
  }
  return undefined;
}

describe('seções e papéis', () => {
  it('seções na ordem da lateral do painel', () => {
    expect(SECTION_IDS).toEqual([
      'overview',
      'growth',
      'ranking',
      'fans',
      'artists',
      'missions',
      'rewards',
      'moderation',
      'audit',
    ]);
  });

  it('rótulos dos papéis', () => {
    expect(ROLE_LABELS).toEqual({ admin: 'Admin', editor: 'Editor', viewer: 'Leitor' });
  });

  it('papel fora do conjunto é recusado', () => {
    expect(parseRole('editor')).toBe('editor');
    for (const role of ['owner', 'Admin', '', null, 1]) {
      expect(reasonOf(() => parseRole(role))).toBe('invalid-role');
    }
  });

  it('seções voltam na ordem da lateral', () => {
    expect(parseSections(['audit', 'fans', 'overview'])).toEqual(['overview', 'fans', 'audit']);
    expect(parseSections([])).toEqual([]);
  });

  it('seção repetida, desconhecida ou lista que não é lista é recusada', () => {
    for (const sections of [['fans', 'fans'], ['playlists'], ['Fans'], 'fans', null, [1]]) {
      expect(reasonOf(() => parseSections(sections))).toBe('invalid-sections');
    }
  });

  it('admin grava sempre todas as seções', () => {
    expect(accessFor('admin', ['fans'])).toEqual({ role: 'admin', sections: [...SECTION_IDS] });
    expect(accessFor('admin', undefined).sections).toEqual([...SECTION_IDS]);
  });

  it('editor e leitor precisam de pelo menos uma seção', () => {
    expect(accessFor('viewer', ['ranking'])).toEqual({ role: 'viewer', sections: ['ranking'] });
    expect(reasonOf(() => accessFor('editor', []))).toBe('invalid-sections');
    expect(reasonOf(() => accessFor('viewer', undefined))).toBe('invalid-sections');
  });

  it('no convite, admin pode vir sem seções; os outros não', () => {
    expect(parseAccess('admin', undefined).sections).toEqual([...SECTION_IDS]);
    expect(reasonOf(() => parseAccess('admin', ['fans', 'fans']))).toBe('invalid-sections');
    expect(reasonOf(() => parseAccess('editor', undefined))).toBe('invalid-sections');
    expect(parseAccess('editor', ['missions', 'fans'])).toEqual({
      role: 'editor',
      sections: ['fans', 'missions'],
    });
  });
});

describe('e-mail, nome e senha', () => {
  it('e-mail sai minúsculo e sem espaço nas pontas', () => {
    expect(parseEmail('  Camila.Ribeiro@Imagine.MUSIC ')).toBe('camila.ribeiro@imagine.music');
  });

  it('e-mail fora do formato é recusado', () => {
    for (const email of [
      '',
      'camila',
      'camila@',
      '@imagine.music',
      'camila@imagine',
      'ca mila@imagine.music',
      'camila@@imagine.music',
      'camila@imagine..music',
      'camila\u0000@imagine.music',
      `${'a'.repeat(250)}@x.io`,
      null,
    ]) {
      expect(reasonOf(() => parseEmail(email))).toBe('invalid-email');
    }
  });

  it('nome em NFC, sem espaço nas pontas, de 1 a 60 unidades de UTF-16', () => {
    expect(parseName('  Cámila Ribeiro '.normalize('NFD'))).toBe('Cámila Ribeiro'.normalize('NFC'));
    expect(parseName('x'.repeat(60))).toBe('x'.repeat(60));
    expect(parseName('Cantora 👩‍🎤')).toBe('Cantora 👩‍🎤');
  });

  it('nome vazio, longo, invisível ou em duas linhas é recusado', () => {
    for (const name of ['', '   ', 'x'.repeat(61), '͏', 'Camila\nRibeiro', 'A‍B', 7]) {
      expect(reasonOf(() => parseName(name))).toBe('invalid-name');
    }
  });

  it('nome sugerido é opcional', () => {
    expect(parseOptionalName(undefined)).toBeNull();
    expect(parseOptionalName(null)).toBeNull();
    expect(parseOptionalName('  ')).toBeNull();
    expect(parseOptionalName('Bruna')).toBe('Bruna');
    expect(reasonOf(() => parseOptionalName('ㅤ'))).toBe('invalid-name');
  });

  it('senha nova com pelo menos 8 caracteres, sem aparar espaços', () => {
    expect(parsePassword('12345678')).toBe('12345678');
    expect(parsePassword(' senha 1 ')).toBe(' senha 1 ');
    expect(reasonOf(() => parsePassword('1234567'))).toBe('weak-password');
    expect(reasonOf(() => parsePassword(undefined))).toBe('weak-password');
    expect(reasonOf(() => parsePassword('x'.repeat(4097)))).toBe('invalid-password');
  });
});

describe('ids e pedido', () => {
  it('id de convite fora do formato dá a resposta de convite inválido', () => {
    expect(parseInviteId('AbC123xyz_-')).toBe('AbC123xyz_-');
    for (const id of ['', 'a/b', '..', 'x'.repeat(65), null, 12]) {
      expect(reasonOf(() => parseInviteId(id))).toBe('invalid');
    }
    expect(reasonOf(() => parseInviteId('a/b', 'invite-not-found'))).toBe('invite-not-found');
  });

  it('uid que quebraria o caminho staff/{uid} é recusado', () => {
    expect(parseUid('Xy12AbC')).toBe('Xy12AbC');
    for (const uid of ['', 'a/b', '.', '..', '__x__', 'x'.repeat(129), undefined]) {
      expect(reasonOf(() => parseUid(uid))).toBe('invalid-request');
    }
  });

  it('corpo da chamada precisa ser um objeto', () => {
    expect(requestFields({ a: 1 })).toEqual({ a: 1 });
    for (const data of [null, undefined, 'x', [1]]) {
      expect(reasonOf(() => requestFields(data))).toBe('invalid-request');
    }
  });
});

describe('validade do convite', () => {
  const now = Date.UTC(2026, 8, 29, 17, 30);

  it('vale 7 dias', () => {
    expect(inviteExpiry(now) - now).toBe(INVITE_TTL_MS);
    expect(INVITE_TTL_MS).toBe(604_800_000);
  });

  it('pendente dentro da validade, vencido depois dela', () => {
    const expiresAt = Timestamp.fromMillis(now + 1000);
    expect(inviteState({ status: 'pending', expiresAt }, now)).toBe('pending');
    expect(inviteState({ status: 'pending', expiresAt }, now + 1000)).toBe('expired');
  });

  it('aceito e cancelado não vencem', () => {
    const expiresAt = Timestamp.fromMillis(now - 1000);
    expect(inviteState({ status: 'accepted', expiresAt }, now)).toBe('accepted');
    expect(inviteState({ status: 'canceled', expiresAt }, now)).toBe('canceled');
  });

  it('o token vai no fragmento do link', () => {
    expect(inviteUrl('https://painel.imagineup.app/', 'abc123', 'TOKEN_x-1')).toBe(
      'https://painel.imagineup.app/convite/abc123#TOKEN_x-1',
    );
    expect(inviteUrl('http://localhost:3000', 'abc', 't')).toBe(
      'http://localhost:3000/convite/abc#t',
    );
  });
});

describe('admins ativos', () => {
  it('só status active com papel admin conta', () => {
    expect(isActiveAdmin({ status: 'active', role: 'admin' })).toBe(true);
    expect(isActiveAdmin({ status: 'disabled', role: 'admin' })).toBe(false);
    expect(isActiveAdmin({ status: 'pending', role: 'admin' })).toBe(false);
    expect(isActiveAdmin({ status: 'active', role: 'editor' })).toBe(false);
    expect(isActiveAdmin(undefined)).toBe(false);
  });

  it('tirar o último admin ativo deixaria o painel sem admin', () => {
    expect(leavesNoActiveAdmin(['a'], 'a')).toBe(true);
    expect(leavesNoActiveAdmin([], 'a')).toBe(true);
    expect(leavesNoActiveAdmin(['a', 'b'], 'a')).toBe(false);
    // O alvo não é admin ativo: sobra quem já era.
    expect(leavesNoActiveAdmin(['a'], 'b')).toBe(false);
  });
});

describe('sessão que usa o acesso (authValidAfter)', () => {
  it('sem o campo, qualquer sessão vale', () => {
    expect(sessionAllowed({}, 1)).toBe(true);
    expect(sessionAllowed({}, undefined)).toBe(true);
  });

  it('conta ligada: só o login que ligou e os seguintes', () => {
    const linked = { authValidAfter: 1_800_000_000 };
    expect(sessionAllowed(linked, 1_799_999_999)).toBe(false);
    expect(sessionAllowed(linked, 1_800_000_000)).toBe(true);
    expect(sessionAllowed(linked, 1_800_000_001)).toBe(true);
    // Token sem auth_time não passa por cima do campo.
    expect(sessionAllowed(linked, undefined)).toBe(false);
  });
});

describe('acesso a uma seção (canSeeSection e canEditSection das regras)', () => {
  const member = (role: string, sections: string[], extra: Record<string, unknown> = {}) => ({
    status: 'active',
    role,
    sections,
    ...extra,
  });

  it('admin altera qualquer seção', () => {
    expect(sectionAccess(member('admin', []), 'artists', 1)).toBe('edit');
  });

  it('editor altera as seções liberadas; leitor só vê', () => {
    expect(sectionAccess(member('editor', ['artists']), 'artists', 1)).toBe('edit');
    expect(sectionAccess(member('viewer', ['artists']), 'artists', 1)).toBe('view');
    expect(sectionAccess(member('editor', ['fans']), 'artists', 1)).toBe('none');
    expect(sectionAccess(member('viewer', ['fans']), 'artists', 1)).toBe('none');
  });

  it('papel desconhecido com a seção só vê, como nas regras', () => {
    expect(sectionAccess(member('owner', ['artists']), 'artists', 1)).toBe('view');
  });

  it('desativado, pendente, sem doc ou com seções que não são lista: nada', () => {
    expect(sectionAccess(member('admin', [], { status: 'disabled' }), 'artists', 1)).toBe('none');
    expect(sectionAccess(member('editor', ['artists'], { status: 'pending' }), 'artists', 1)).toBe(
      'none',
    );
    expect(sectionAccess(undefined, 'artists', 1)).toBe('none');
    expect(
      sectionAccess({ status: 'active', role: 'editor', sections: 'artists' }, 'artists', 1),
    ).toBe('none');
  });

  it('sessão de antes do authValidAfter não usa o acesso', () => {
    const linked = member('admin', [], { authValidAfter: 1_800_000_000 });
    expect(isActiveMember(linked, 1_799_999_999)).toBe(false);
    expect(sectionAccess(linked, 'artists', 1_799_999_999)).toBe('none');
    expect(sectionAccess(linked, 'artists', 1_800_000_000)).toBe('edit');
  });
});
