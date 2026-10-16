import { Firestore, GeoPoint, Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import {
  AFTER_MAX_LENGTH,
  EXPORT_NOTICES,
  EXPORT_PAGE_SIZE,
  exportAccount,
  exportFields,
  exportHeader,
  exportItem,
  exportList,
  isRecentLogin,
  parseAfter,
  parsePart,
  RECENT_LOGIN_MAX_SECONDS,
  sameEmail,
  toExportValue,
} from './model';
import { FAN_DATA_PARTS, fanDataSource } from './sources';

// O arquivo dos dados do fã (seção 32, 32.3), puro: os valores do Firestore
// em JSON, o filtro de campos de cada fonte (o dado técnico e o de outra
// pessoa ou da equipe saem), a máscara do extrato, a conta do Auth, as
// entradas das páginas e o login recente.

// Só monta referências de documento: nada aqui fala com o Firestore.
const db = new Firestore({ projectId: 'demo-imagine-up-app' });

const AT = Timestamp.fromMillis(Date.parse('2026-10-14T13:00:00.000Z'));

const errorOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error as { code: string; details: Record<string, unknown> };
  }
  throw new Error('Deveria ter falhado.');
};

describe('toExportValue', () => {
  it('o Timestamp em ISO, em UTC', () => {
    expect(toExportValue(AT)).toBe('2026-10-14T13:00:00.000Z');
  });

  it('a referência de documento vira o caminho', () => {
    expect(toExportValue(db.doc('posts/p-clipe/postComments/c1'))).toBe(
      'posts/p-clipe/postComments/c1',
    );
  });

  it('o GeoPoint vira latitude e longitude', () => {
    expect(toExportValue(new GeoPoint(-12.97, -38.5))).toEqual({
      latitude: -12.97,
      longitude: -38.5,
    });
  });

  it('os bytes em base64', () => {
    expect(toExportValue(Buffer.from('imagineup'))).toBe('aW1hZ2luZXVw');
    expect(toExportValue(new Uint8Array([0, 255]))).toBe('AP8=');
  });

  it('o texto, o número, o booleano e o null como estão; o undefined vira null', () => {
    expect(toExportValue('Camila')).toBe('Camila');
    expect(toExportValue(0)).toBe(0);
    expect(toExportValue(-12.5)).toBe(-12.5);
    expect(toExportValue(false)).toBe(false);
    expect(toExportValue(null)).toBeNull();
    expect(toExportValue(undefined)).toBeNull();
  });

  it('mapas e listas, recursivos', () => {
    expect(
      toExportValue({
        days: { '2026-10-14': { count: { like: 2 }, at: AT } },
        blocked: ['uidBia', 'uidDuda'],
        history: [{ at: AT, ref: db.doc('events/e1') }, [AT, null]],
        empty: {},
        none: null,
      }),
    ).toEqual({
      days: { '2026-10-14': { count: { like: 2 }, at: '2026-10-14T13:00:00.000Z' } },
      blocked: ['uidBia', 'uidDuda'],
      history: [
        { at: '2026-10-14T13:00:00.000Z', ref: 'events/e1' },
        ['2026-10-14T13:00:00.000Z', null],
      ],
      empty: {},
      none: null,
    });
  });

  it('o resultado passa pelo JSON sem perder nada', () => {
    const value = toExportValue({ at: AT, point: new GeoPoint(1, 2), list: [1, 'a', null] });
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });
});

describe('o perfil: os campos técnicos saem', () => {
  it('sem searchKeys, signupCounted e photoPath; o resto como está gravado', () => {
    expect(
      exportFields(fanDataSource('users'), {
        displayName: 'Camila Ribeiro',
        username: 'camilarib',
        photoURL: 'https://exemplo.test/foto.jpg',
        photoPath: 'fans/uidCamila/photo-1.jpg',
        photoUpdatedAt: AT,
        searchKeys: ['ca', 'cam'],
        signupCounted: true,
        usernameChangeableAt: null,
        usernameLockReason: 'moderation',
        createdAt: AT,
      }),
    ).toEqual({
      displayName: 'Camila Ribeiro',
      username: 'camilarib',
      photoURL: 'https://exemplo.test/foto.jpg',
      photoUpdatedAt: '2026-10-14T13:00:00.000Z',
      usernameChangeableAt: null,
      usernameLockReason: 'moderation',
      createdAt: '2026-10-14T13:00:00.000Z',
    });
  });
});

describe('a carteira: sem os resumos das missões', () => {
  it('os keys de cada missão saem, o progresso fica', () => {
    expect(
      exportFields(fanDataSource('wallets'), {
        balance: 12_480,
        missions: {
          daily: {
            key: '2026-10-14',
            items: {
              m1: { current: 2, keys: ['abc', 'def'], completedAt: null, rewardPaid: 0 },
              m2: { current: 5, keys: ['ghi'], completedAt: AT, rewardPaid: 50 },
            },
          },
          weekly: null,
        },
        achievements: { 'top-20': 1 },
      }),
    ).toEqual({
      balance: 12_480,
      missions: {
        daily: {
          key: '2026-10-14',
          items: {
            m1: { current: 2, completedAt: null, rewardPaid: 0 },
            m2: { current: 5, completedAt: '2026-10-14T13:00:00.000Z', rewardPaid: 50 },
          },
        },
        weekly: null,
      },
      achievements: { 'top-20': 1 },
    });
  });

  it('a carteira sem missões não quebra', () => {
    expect(exportFields(fanDataSource('wallets'), { balance: 0, missions: null })).toEqual({
      balance: 0,
      missions: null,
    });
  });
});

describe('o extrato: sem o uid, o actor só com o type e a máscara do convite', () => {
  const ledger = fanDataSource('wallets.ledger');
  const entry = (id: string, data: Record<string, unknown>) =>
    exportItem(ledger, { id, path: `wallets/uidCamila/ledger/${id}`, data });

  it('o lançamento do convite: o id só com a origem, sem o eventId (a chave da pessoa trazida)', () => {
    for (const source of ['invite_visit', 'invite_signup']) {
      expect(
        entry(`${source}:chaveHmacDaPessoa`, {
          uid: 'uidCamila',
          kind: 'earn',
          source,
          eventId: 'chaveHmacDaPessoa',
          points: 50,
          subject: { type: 'invite', id: 'CAMILA12' },
          actor: { type: 'fan', uid: 'uidBia', name: 'Bia' },
          createdAt: AT,
        }),
      ).toEqual({
        id: source,
        kind: 'earn',
        source,
        points: 50,
        subject: { type: 'invite', id: 'CAMILA12' },
        actor: { type: 'fan' },
        createdAt: '2026-10-14T13:00:00.000Z',
      });
    }
  });

  it('a missão que o convidado pagou: o id fica, o actor perde o uid dele', () => {
    expect(
      entry('mission:leve-5:2026-W42', {
        uid: 'uidCamila',
        source: 'mission',
        eventId: 'leve-5:2026-W42',
        actor: { type: 'fan', uid: 'uidBia', name: null },
      }),
    ).toEqual({
      id: 'mission:leve-5:2026-W42',
      source: 'mission',
      eventId: 'leve-5:2026-W42',
      actor: { type: 'fan' },
    });
  });

  it('o ajuste e a devolução da equipe: sem o uid e o nome de quem é da equipe e sem o motivo', () => {
    // O painel diz a quem ajusta que o fã não vê o motivo (o `note`).
    expect(
      entry('adjustment:aj12345678', {
        uid: 'uidCamila',
        source: 'adjustment',
        eventId: 'aj12345678',
        note: 'Devolução do show cancelado',
        actor: { type: 'staff', uid: 'uidEquipe', name: 'Equipe ImagineUP' },
      }),
    ).toEqual({
      id: 'adjustment:aj12345678',
      source: 'adjustment',
      eventId: 'aj12345678',
      actor: { type: 'staff' },
    });
    expect(
      entry('redeem_refund:UP-9FJT6V', {
        source: 'redeem_refund',
        eventId: 'UP-9FJT6V',
        actor: { type: 'staff', uid: 'uidEquipe', name: 'Equipe' },
      }).actor,
    ).toEqual({ type: 'staff' });
  });

  it('a curtida do próprio fã: o id e o eventId ficam', () => {
    expect(
      entry('like:p-nenho-4', {
        source: 'like',
        eventId: 'p-nenho-4',
        actor: { type: 'fan', uid: 'uidCamila', name: 'Camila' },
      }),
    ).toEqual({
      id: 'like:p-nenho-4',
      source: 'like',
      eventId: 'p-nenho-4',
      actor: { type: 'fan' },
    });
  });

  it('o actor torto não quebra', () => {
    expect(entry('seed:x', { source: 'seed', actor: { uid: 'uidBia' } }).actor).toEqual({});
    expect(entry('seed:y', { source: 'seed', actor: null }).actor).toBeNull();
  });
});

describe('o omit das outras fontes: o dado de outra pessoa ou da equipe sai', () => {
  it('o código de convite sem o ownerKey', () => {
    expect(
      exportItem(fanDataSource('inviteCodes'), {
        id: 'CAMILA12',
        path: 'inviteCodes/CAMILA12',
        data: { code: 'CAMILA12', uid: 'uidCamila', ownerKey: 'chaveHmac', createdAt: AT },
      }),
    ).toEqual({
      id: 'CAMILA12',
      code: 'CAMILA12',
      uid: 'uidCamila',
      createdAt: '2026-10-14T13:00:00.000Z',
    });
  });

  it('a origem sem o inviterUid, o award e o inviterRemovedAt, que são de quem convidou', () => {
    expect(
      exportFields(fanDataSource('referrals'), {
        uid: 'uidBia',
        inviterUid: null,
        code: 'CAMILA12',
        via: 'link',
        utm: { source: 'instagram' },
        award: { visit: 'skipped', signup: 'capped' },
        inviterRemovedAt: AT,
      }),
    ).toEqual({ uid: 'uidBia', code: 'CAMILA12', via: 'link', utm: { source: 'instagram' } });
  });

  it('o comentário com o postId, pelo caminho, e sem o hiddenBy', () => {
    expect(
      exportItem(fanDataSource('postComments'), {
        id: 'c1',
        path: 'posts/p-clipe/postComments/c1',
        data: {
          authorUid: 'uidCamila',
          text: 'Que clipe!',
          status: 'hidden',
          hiddenAt: AT,
          hiddenBy: 'uidEquipe',
        },
      }),
    ).toEqual({
      id: 'c1',
      postId: 'p-clipe',
      authorUid: 'uidCamila',
      text: 'Que clipe!',
      status: 'hidden',
      hiddenAt: '2026-10-14T13:00:00.000Z',
    });
  });

  it('a denúncia de perfil sem o round; o alvo fica (pergunta 7)', () => {
    expect(
      exportItem(fanDataSource('profileReports'), {
        id: 'uidPromo_uidCamila',
        path: 'profileReports/uidPromo_uidCamila',
        data: { targetUid: 'uidPromo', reporterUid: 'uidCamila', reason: 'spam', round: 3 },
      }),
    ).toEqual({
      id: 'uidPromo_uidCamila',
      targetUid: 'uidPromo',
      reporterUid: 'uidCamila',
      reason: 'spam',
    });
  });

  it('a denúncia de comentário vai inteira, com o autor do comentário (pergunta 7)', () => {
    const data = {
      commentId: 'c9',
      postId: 'p-show',
      artistId: 'nenho',
      commentAuthorUid: 'uidEnzo',
      reporterUid: 'uidCamila',
      reason: null,
      day: '2026-10-14',
    };
    expect(
      exportItem(fanDataSource('commentReports'), {
        id: 'c9_uidCamila',
        path: 'commentReports/c9_uidCamila',
        data,
      }),
    ).toEqual({ id: 'c9_uidCamila', ...data });
  });

  it('o pedido da loja sem o updatedBy', () => {
    expect(
      exportItem(fanDataSource('redemptions'), {
        id: 'UP-9FJT6V',
        path: 'redemptions/UP-9FJT6V',
        data: {
          uid: 'uidCamila',
          status: 'refused',
          refusalReason: 'Show cancelado',
          updatedBy: { uid: 'uidEquipe', name: 'Equipe' },
        },
      }),
    ).toEqual({
      id: 'UP-9FJT6V',
      uid: 'uidCamila',
      status: 'refused',
      refusalReason: 'Show cancelado',
    });
  });

  it('a temporada com o id dela, e não o uid do fã', () => {
    expect(
      exportItem(fanDataSource('standings'), {
        id: 'uidCamila',
        path: 'seasons/carnaval/standings/uidCamila',
        data: { uid: 'uidCamila', seasonId: 'carnaval', position: 12, points: 4_120 },
      }),
    ).toEqual({
      id: 'carnaval',
      uid: 'uidCamila',
      seasonId: 'carnaval',
      position: 12,
      points: 4_120,
    });
  });

  it('o campo gravado com o nome id perde para o id do documento', () => {
    expect(
      exportItem(fanDataSource('users.centrals'), {
        id: 'nenho',
        path: 'users/uidCamila/centrals/nenho',
        data: { id: 'outro', artistId: 'nenho' },
      }),
    ).toEqual({ id: 'nenho', artistId: 'nenho' });
  });

  it('a fonte sem omit vai como está gravada', () => {
    const data = { artistId: 'nenho', joinedAt: AT, member: true };
    expect(
      exportItem(fanDataSource('users.centrals'), {
        id: 'nenho',
        path: 'users/uidCamila/centrals/nenho',
        data,
      }),
    ).toEqual({ id: 'nenho', ...(toExportValue(data) as object) });
  });
});

describe('as listas', () => {
  it('as reservas de @ levam só os ids', () => {
    expect(
      exportList(fanDataSource('usernames'), [
        { id: 'camilarib', path: 'usernames/camilarib', data: { uid: 'uidCamila', createdAt: AT } },
        { id: 'camila_r', path: 'usernames/camila_r', data: { uid: 'uidCamila' } },
      ]),
    ).toEqual(['camilarib', 'camila_r']);
  });

  it('as outras levam cada documento, com o filtro da fonte', () => {
    expect(
      exportList(fanDataSource('inviteCodes'), [
        { id: 'CAMILA12', path: 'inviteCodes/CAMILA12', data: { uid: 'uidCamila', ownerKey: 'k' } },
      ]),
    ).toEqual([{ id: 'CAMILA12', uid: 'uidCamila' }]);
    expect(exportList(fanDataSource('commentReports'), [])).toEqual([]);
  });
});

describe('a conta do Authentication', () => {
  it('o nome do Auth, o e-mail, a confirmação, cada provedor com o e-mail e as datas em ISO', () => {
    expect(
      exportAccount({
        displayName: 'Camila Ribeiro',
        email: 'camila@teste.imagineup',
        emailVerified: false,
        providerData: [
          { providerId: 'password', email: 'camila@teste.imagineup' },
          { providerId: 'google.com', email: 'camila.r@exemplo.test' },
        ],
        metadata: {
          creationTime: 'Sat, 10 Oct 2026 12:00:00 GMT',
          lastSignInTime: 'Mon, 19 Oct 2026 22:10:00 GMT',
        },
      }),
    ).toEqual({
      nome: 'Camila Ribeiro',
      email: 'camila@teste.imagineup',
      emailConfirmado: false,
      provedores: [
        { id: 'password', email: 'camila@teste.imagineup' },
        { id: 'google.com', email: 'camila.r@exemplo.test' },
      ],
      criadaEm: '2026-10-10T12:00:00.000Z',
      ultimoLoginEm: '2026-10-19T22:10:00.000Z',
    });
  });

  it('nunca o hash da senha, os tokens nem as declarações, mesmo que venham', () => {
    const account = exportAccount({
      displayName: undefined,
      email: undefined,
      emailVerified: true,
      providerData: [{ providerId: 'apple.com' }],
      metadata: { creationTime: '', lastSignInTime: null },
      passwordHash: 'hash',
      passwordSalt: 'sal',
      tokensValidAfterTime: 'Sat, 10 Oct 2026 12:00:00 GMT',
      customClaims: { admin: true },
    } as Parameters<typeof exportAccount>[0]);
    expect(account).toEqual({
      nome: null,
      email: null,
      emailConfirmado: true,
      provedores: [{ id: 'apple.com', email: null }],
      criadaEm: null,
      ultimoLoginEm: null,
    });
  });
});

describe('o começo do arquivo', () => {
  it('o formato, a versão, a data, o uid e os avisos, nesta ordem', () => {
    expect(exportHeader('uidCamila', Date.parse('2026-10-20T13:00:00.000Z'))).toEqual({
      formato: 'imagineup-dados-do-fa',
      versao: 1,
      geradoEm: '2026-10-20T13:00:00.000Z',
      uid: 'uidCamila',
      avisos: [
        'Este arquivo traz os dados da sua conta no ImagineUP no momento em que foi gerado.',
        'As datas estão em UTC, no formato ISO 8601.',
        'Os campos com uid no nome, como reporterUid e targetUid, guardam o identificador interno de uma conta.',
        'A foto do perfil está no endereço do campo photoURL.',
        'Os registros de acesso (data, hora e endereço IP) ficam guardados por 6 meses, como pede o Marco Civil da Internet (art. 15). Eles não estão neste arquivo. Para pedir, responda ao e-mail da equipe.',
      ],
    });
  });

  it('os avisos sem travessão nem meia-risca, e a cópia não muda a constante', () => {
    for (const notice of EXPORT_NOTICES) expect(notice).not.toMatch(/[–—]/);
    const header = exportHeader('uidCamila', 0);
    header.avisos.pop();
    expect(EXPORT_NOTICES).toHaveLength(5);
  });

  it('as páginas de 500', () => {
    expect(EXPORT_PAGE_SIZE).toBe(500);
  });
});

describe('o e-mail do pedido', () => {
  it('confere sem diferença de maiúsculas, e nunca sem e-mail na conta', () => {
    expect(sameEmail('Camila@Teste.ImagineUP', 'camila@teste.imagineup')).toBe(true);
    expect(sameEmail('camila@teste.imagineup', 'camila@teste.imagineup')).toBe(true);
    expect(sameEmail('bia@teste.imagineup', 'camila@teste.imagineup')).toBe(false);
    expect(sameEmail(undefined, 'camila@teste.imagineup')).toBe(false);
    expect(sameEmail(null, 'camila@teste.imagineup')).toBe(false);
  });
});

describe('parsePart', () => {
  it.each([...FAN_DATA_PARTS])('%s passa', (part) => {
    expect(parsePart(part)).toBe(part);
  });

  it.each([undefined, null, '', 'Extrato', 'conta', 'denunciasDeComentario', 7, ['extrato']])(
    '%j é invalid-request com o campo part',
    (value) => {
      expect(errorOf(() => parsePart(value))).toMatchObject({
        code: 'invalid-argument',
        details: { reason: 'invalid-request', field: 'part' },
      });
    },
  );
});

describe('parseAfter', () => {
  it('ausente é a primeira página', () => {
    expect(parseAfter('extrato', undefined)).toBeNull();
    expect(parseAfter('comentarios', undefined)).toBeNull();
  });

  it('o null (o after da página que fecha a parte) é recusado: a parte não recomeça', () => {
    expect(errorOf(() => parseAfter('extrato', null))).toMatchObject({
      details: { reason: 'invalid-request', field: 'after' },
    });
  });

  it('nas partes de coleção, o id de verdade do último documento (com o : do extrato)', () => {
    expect(parseAfter('extrato', 'invite_visit:chaveHmacDaPessoa')).toBe(
      'invite_visit:chaveHmacDaPessoa',
    );
    expect(parseAfter('pedidosDaLoja', 'UP-9FJT6V')).toBe('UP-9FJT6V');
    expect(parseAfter('curtidas', 'a'.repeat(AFTER_MAX_LENGTH))).toBe('a'.repeat(1500));
  });

  it('nos comentários, o caminho completo do último comentário', () => {
    expect(parseAfter('comentarios', 'posts/p-clipe/postComments/c1')).toBe(
      'posts/p-clipe/postComments/c1',
    );
  });

  it.each([
    ['extrato', ''],
    ['extrato', 'wallets/uidCamila/ledger/like:p1'],
    ['extrato', 'a/b'],
    ['extrato', '.'],
    ['extrato', '..'],
    ['extrato', '__name__'],
    ['curtidas', 'a'.repeat(1501)],
    ['centrais', 42],
    ['centrais', { id: 'nenho' }],
    ['comentarios', 'c1'],
    ['comentarios', 'posts/p-clipe'],
    ['comentarios', 'posts/p-clipe/postComments/c1/x'],
    ['comentarios', 'events/e1/postComments/c1'],
    ['comentarios', 'posts/p-clipe/comments/c1'],
    ['comentarios', 'posts//postComments/c1'],
    ['comentarios', 'posts/../postComments/c1'],
    ['comentarios', 'posts/p-clipe/postComments/__x__'],
  ] as const)('%s com %j é invalid-request com o campo after', (part, value) => {
    expect(errorOf(() => parseAfter(part, value))).toMatchObject({
      details: { reason: 'invalid-request', field: 'after' },
    });
  });
});

describe('isRecentLogin', () => {
  const AUTH_TIME = 1_792_000_000;
  const at = (seconds: number) => (AUTH_TIME + seconds) * 1000;

  it('até 10 minutos depois do login, passa; no limite exato de 600 s também', () => {
    expect(RECENT_LOGIN_MAX_SECONDS).toBe(600);
    expect(isRecentLogin(AUTH_TIME, at(0))).toBe(true);
    expect(isRecentLogin(AUTH_TIME, at(599))).toBe(true);
    expect(isRecentLogin(AUTH_TIME, at(600))).toBe(true);
  });

  it('um instante depois de 600 s, não passa', () => {
    expect(isRecentLogin(AUTH_TIME, at(600) + 1)).toBe(false);
    expect(isRecentLogin(AUTH_TIME, at(660))).toBe(false);
  });

  it('o relógio do servidor um pouco atrás do login (o auth_time no futuro) passa', () => {
    expect(isRecentLogin(AUTH_TIME, at(-5))).toBe(true);
  });

  it('sem o auth_time, ou fora do formato, não passa', () => {
    for (const value of [undefined, null, '1792000000', Number.NaN, Infinity]) {
      expect(isRecentLogin(value, at(0))).toBe(false);
    }
  });
});
