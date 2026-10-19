import { describe, expect, it } from 'vitest';

import {
  FAN_DATA_FIRST_KEYS,
  FAN_DATA_PARENTS,
  FAN_DATA_PARTS,
  FAN_DATA_SOURCES,
  fanDataSource,
  firstKeySource,
  knownSubcollections,
  partSource,
  PROFILE_TECHNICAL_FIELDS,
} from './sources';

// A lista das fontes de dados do fã (seção 32, decisão 8 e 32.3): a que a
// exportação percorre e o teste de emulador prende à exclusão de conta.

describe('a lista das fontes', () => {
  it('os nomes são únicos', () => {
    const ids = FAN_DATA_SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('toda fonte tem o lugar e o que a exclusão faz com ela', () => {
    for (const source of FAN_DATA_SOURCES) {
      expect(source.label, source.id).not.toBe('');
      expect(source.deletion.note, source.id).not.toBe('');
    }
  });

  it('toda fonte fora do arquivo tem o motivo', () => {
    const out = FAN_DATA_SOURCES.filter((source) => source.place.in === 'out');
    expect(out.map((source) => source.id)).toEqual([
      'users.profileSync',
      'users.uploads',
      'users.fanClubCredits',
      'fanInvites.inviteVisitors',
      'inviterLedger',
      'moderationQueue',
      'profileReportQueue',
      'fanClubReportQueue',
      'idempotency',
      'staff',
      'staffAudit',
      'accessLog',
    ]);
    for (const source of out) {
      expect(source.place.in === 'out' && source.place.reason.length, source.id).toBeGreaterThan(
        10,
      );
    }
  });

  it('nenhum texto da lista tem travessão nem meia-risca', () => {
    for (const source of FAN_DATA_SOURCES) {
      const texts = [
        source.label,
        source.deletion.note,
        source.place.in === 'out' ? source.place.reason : '',
      ];
      for (const text of texts) expect(text, source.id).not.toMatch(/[–—]/);
    }
  });
});

describe('as partes longas', () => {
  it('as 9 partes, na ordem do arquivo (32.3; as publicações do fã-clube desde a seção 34)', () => {
    expect(FAN_DATA_PARTS).toEqual([
      'extrato',
      'pontosPorCentral',
      'centrais',
      'curtidas',
      'presencas',
      'comentarios',
      'linksDeConvite',
      'pedidosDaLoja',
      'publicacoesDeFaClube',
    ]);
  });

  it('cada parte tem uma fonte só, e toda fonte com parte é uma delas', () => {
    const parts = FAN_DATA_SOURCES.flatMap((source) =>
      source.place.in === 'part' ? [source.place.part] : [],
    );
    expect([...parts].sort()).toEqual([...FAN_DATA_PARTS].sort());
  });

  it('toda fonte com parte tem o leitor: uma subcoleção, uma igualdade ou o grupo, pela ordem do id', () => {
    for (const part of FAN_DATA_PARTS) {
      const { read } = partSource(part);
      expect(['sub', 'equal', 'group'], part).toContain(read.kind);
    }
  });

  it('os leitores de cada parte', () => {
    expect(Object.fromEntries(FAN_DATA_PARTS.map((part) => [part, partSource(part).read]))).toEqual(
      {
        extrato: { kind: 'sub', parent: 'wallets', name: 'ledger' },
        pontosPorCentral: { kind: 'sub', parent: 'wallets', name: 'centralPoints' },
        centrais: { kind: 'sub', parent: 'users', name: 'centrals' },
        curtidas: { kind: 'sub', parent: 'users', name: 'postLikes' },
        presencas: { kind: 'sub', parent: 'users', name: 'eventRsvps' },
        comentarios: {
          kind: 'group',
          group: 'postComments',
          parent: 'posts',
          field: 'authorUid',
        },
        linksDeConvite: { kind: 'sub', parent: 'fanInvites', name: 'inviteLinks' },
        pedidosDaLoja: { kind: 'equal', collection: 'redemptions', field: 'uid' },
        publicacoesDeFaClube: { kind: 'equal', collection: 'fanClubPosts', field: 'authorUid' },
      },
    );
  });
});

describe('a primeira chamada', () => {
  it('as chaves, na ordem do arquivo (32.3)', () => {
    expect(FAN_DATA_FIRST_KEYS).toEqual([
      'conta',
      'perfil',
      'contato',
      'arrobasReservados',
      'carteira',
      'convite',
      'codigosDeConvite',
      'origem',
      'pessoasTrazidas',
      'bloqueios',
      'denunciasDeComentario',
      'denunciasDePerfil',
      'temporadas',
      'candidaturaDeFaClube',
      'candidaturaDeFaClubePrivada',
      'faClubes',
      'denunciasDeFaClube',
      'faClubesSeguidos',
    ]);
  });

  it('cada chave tem uma fonte só, e nenhuma chave fica sem fonte', () => {
    const keys = FAN_DATA_SOURCES.flatMap((source) =>
      source.place.in === 'first' ? [source.place.key] : [],
    );
    expect([...keys].sort()).toEqual([...FAN_DATA_FIRST_KEYS].sort());
  });

  it('o leitor e a forma de cada chave', () => {
    expect(
      Object.fromEntries(FAN_DATA_FIRST_KEYS.map((key) => [key, firstKeySource(key).read])),
    ).toEqual({
      conta: { kind: 'auth' },
      perfil: { kind: 'doc', collection: 'users' },
      contato: { kind: 'subdoc', parent: 'users', name: 'contact', id: 'main' },
      arrobasReservados: { kind: 'equal', collection: 'usernames', field: 'uid' },
      carteira: { kind: 'doc', collection: 'wallets' },
      convite: { kind: 'doc', collection: 'fanInvites' },
      codigosDeConvite: { kind: 'equal', collection: 'inviteCodes', field: 'uid' },
      origem: { kind: 'doc', collection: 'referrals' },
      pessoasTrazidas: { kind: 'count', collection: 'referrals', field: 'inviterUid' },
      bloqueios: { kind: 'doc', collection: 'blockLists' },
      denunciasDeComentario: { kind: 'equal', collection: 'commentReports', field: 'reporterUid' },
      denunciasDePerfil: { kind: 'equal', collection: 'profileReports', field: 'reporterUid' },
      temporadas: { kind: 'standings' },
      candidaturaDeFaClube: { kind: 'doc', collection: 'fanClubApplications' },
      candidaturaDeFaClubePrivada: { kind: 'doc', collection: 'fanClubApplicationPrivate' },
      faClubes: { kind: 'equal', collection: 'fanClubs', field: 'ownerUid' },
      denunciasDeFaClube: { kind: 'equal', collection: 'fanClubReports', field: 'reporterUid' },
      faClubesSeguidos: { kind: 'sub', parent: 'users', name: 'fanClubFollows' },
    });
    expect(firstKeySource('arrobasReservados').idsOnly).toBe(true);
    expect(firstKeySource('temporadas').idFromParent).toBe(true);
  });

  it('a foto vai pelo endereço, no photoURL do perfil', () => {
    expect(fanDataSource('storage.fans').place).toEqual({
      in: 'address',
      key: 'perfil',
      field: 'photoURL',
    });
  });

  it('as fotos das publicações do fã-clube vão pelo endereço, na media delas', () => {
    expect(fanDataSource('storage.fanClubMedia').place).toEqual({
      in: 'address',
      key: 'publicacoesDeFaClube',
      field: 'media',
    });
  });
});

describe('o filtro de campos (decisão 8)', () => {
  it('o omit e a máscara de cada fonte', () => {
    const filtered = FAN_DATA_SOURCES.filter((source) => source.omit.length > 0 || source.mask);
    expect(
      Object.fromEntries(filtered.map((source) => [source.id, [source.omit, source.mask ?? null]])),
    ).toEqual({
      users: [['searchKeys', 'signupCounted', 'photoPath'], null],
      'users.centrals': [['fanClubId'], null],
      'users.fanClubFollows': [['byOwnerCode'], null],
      wallets: [['missions.*.items.*.keys'], null],
      'wallets.ledger': [['uid', 'note'], 'ledger'],
      inviteCodes: [['ownerKey'], null],
      referrals: [['inviterUid', 'award', 'inviterRemovedAt'], null],
      postComments: [['hiddenBy'], null],
      profileReports: [['round'], null],
      redemptions: [['updatedBy'], null],
      fanClubApplications: [['decidedBy'], null],
      fanClubs: [['approvedBy', 'closedBy', 'featuredBy'], null],
      fanClubPosts: [['reviewedBy'], null],
      fanClubReports: [['round'], null],
    });
    expect(PROFILE_TECHNICAL_FIELDS).toEqual(['searchKeys', 'signupCounted', 'photoPath']);
  });

  it('só as fontes do arquivo filtram campos (a de fora não vai)', () => {
    for (const source of FAN_DATA_SOURCES) {
      if (source.place.in === 'out') expect(source.omit, source.id).toEqual([]);
    }
  });

  it('o comentário leva o postId, pelo caminho', () => {
    expect(fanDataSource('postComments').parentField).toBe('postId');
  });
});

describe('o que a exclusão faz', () => {
  it('cada fonte, pela tabela de 32.3', () => {
    expect(
      Object.fromEntries(FAN_DATA_SOURCES.map((source) => [source.id, source.deletion.effect])),
    ).toEqual({
      auth: 'account',
      users: 'deleted',
      'users.centrals': 'deleted',
      'users.postLikes': 'deleted',
      'users.eventRsvps': 'deleted',
      'users.profileSync': 'deleted',
      'users.uploads': 'deleted',
      'users.fanClubCredits': 'deleted',
      'users.fanClubFollows': 'deleted',
      'users.contact': 'deleted',
      usernames: 'deleted',
      wallets: 'deleted',
      'wallets.ledger': 'deleted',
      'wallets.centralPoints': 'deleted',
      fanInvites: 'deleted',
      'fanInvites.inviteLinks': 'deleted',
      'fanInvites.inviteVisitors': 'deleted',
      inviteCodes: 'deleted',
      referrals: 'deleted',
      'referrals.inviter': 'detached',
      inviterLedger: 'kept',
      postComments: 'deleted',
      commentReports: 'deleted',
      profileReports: 'deleted',
      blockLists: 'deleted',
      redemptions: 'stripped',
      standings: 'deleted',
      fanClubApplications: 'deleted',
      fanClubApplicationPrivate: 'deleted',
      fanClubs: 'stripped',
      fanClubPosts: 'deleted',
      fanClubReports: 'deleted',
      moderationQueue: 'kept',
      profileReportQueue: 'kept',
      fanClubReportQueue: 'kept',
      idempotency: 'deleted',
      staff: 'deleted',
      'storage.fans': 'deleted',
      'storage.fanClubMedia': 'deleted',
      staffAudit: 'kept',
      accessLog: 'kept',
    });
  });
});

describe('as subcoleções conhecidas (o teste do listCollections)', () => {
  it('as de users, wallets e fanInvites, do arquivo e de fora', () => {
    expect(FAN_DATA_PARENTS).toEqual(['users', 'wallets', 'fanInvites']);
    expect(knownSubcollections('users')).toEqual([
      'centrals',
      'postLikes',
      'eventRsvps',
      'profileSync',
      'uploads',
      'fanClubCredits',
      'fanClubFollows',
      'contact',
    ]);
    expect(knownSubcollections('wallets')).toEqual(['ledger', 'centralPoints']);
    expect(knownSubcollections('fanInvites')).toEqual(['inviteLinks', 'inviteVisitors']);
  });
});

describe('a fonte pelo nome', () => {
  it('o nome desconhecido é erro de código', () => {
    expect(() => fanDataSource('nada')).toThrow('Fonte de dados do fã desconhecida: nada');
  });
});
