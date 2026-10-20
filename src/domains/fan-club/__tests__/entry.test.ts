import { ApiError } from '@/services/api/errors';

import {
  canApplyNow,
  fanClubStageOf,
  hasNewPrize,
  isDefinitiveRefusal,
  leaveCentralNotes,
  liveFanClub,
  nextRoundOf,
  settingsRowOf,
  shownFanClub,
} from '../entry';
import type { FanClubApplication, MyFanClub, MyFanClubClub } from '../types';

// O que o fã vê do fã-clube pelo `GET /me/fan-club` (34.9, itens 1 a 5): a
// linha dos Ajustes, a tela "/meu-fa-clube" e a inércia antes da abertura.

const PROGRAM = {
  open: true,
  rulesUrl: null,
  rulesVersion: 'termos-2026-10',
  notice: null,
} as const;

const application = (patch: Partial<FanClubApplication> = {}): FanClubApplication => ({
  status: 'pending',
  artistId: 'nettobrito',
  artistName: 'Netto Brito',
  proposedName: 'Netto de Coração',
  round: 1,
  submittedAt: '2026-10-18T15:00:00.000Z',
  rejectReason: null,
  canReapplyAt: null,
  canApply: false,
  history: [],
  ...patch,
});

const club = (patch: Partial<MyFanClubClub> = {}): MyFanClubClub => ({
  id: 'fc-1',
  name: 'Netto de Coração',
  artistId: 'nettobrito',
  artistName: 'Netto Brito',
  status: 'active',
  postCount: 2,
  pendingPosts: 1,
  photosAllowed: true,
  featuredUntil: null,
  lastReward: null,
  available: true,
  unavailableReason: null,
  rulesOutdated: false,
  ...patch,
});

const mine = (patch: Partial<MyFanClub> = {}): MyFanClub => ({
  ...PROGRAM,
  application: null,
  club: null,
  ...patch,
});

describe('shownFanClub: nada aparece antes da abertura', () => {
  it('sem resposta, nada', () => {
    expect(shownFanClub(undefined, null)).toBeNull();
  });

  it('o 404 da api de antes da publicação (rota que não existe) esconde, mesmo com a resposta guardada', () => {
    const notFound = new ApiError('notFound', 'Não encontrado.', 404, 'not_found');
    expect(shownFanClub(undefined, notFound)).toBeNull();
    expect(shownFanClub(mine(), notFound)).toBeNull();
  });

  it('a falha incerta e o ritmo deixam a resposta que já estava', () => {
    expect(shownFanClub(mine(), new ApiError('network', 'Sem rede.'))).not.toBeNull();
    expect(
      shownFanClub(mine(), new ApiError('rateLimited', 'Ritmo.', 429, 'rate_limited')),
    ).not.toBeNull();
  });

  it('o programa fechado esconde para quem nunca se candidatou, e mostra para quem tem candidatura', () => {
    expect(shownFanClub(mine({ open: false }), null)).toBeNull();
    const withApplication = mine({ open: false, application: application() });
    expect(shownFanClub(withApplication, null)).toBe(withApplication);
    expect(shownFanClub(mine(), null)).not.toBeNull();
  });
});

describe('fanClubStageOf: o estado da tela', () => {
  it('sem candidatura: a apresentação; com o programa fechado, a frase do fechado', () => {
    expect(fanClubStageOf(mine())).toEqual({ kind: 'intro' });
    expect(fanClubStageOf(mine({ open: false }))).toEqual({ kind: 'programClosed' });
  });

  it('em análise', () => {
    expect(fanClubStageOf(mine({ application: application() })).kind).toBe('pending');
  });

  it('aprovada com o fã-clube ativo ou pausado: o "Meu fã-clube"', () => {
    for (const status of ['active', 'paused'] as const) {
      const stage = fanClubStageOf(
        mine({ application: application({ status: 'approved' }), club: club({ status }) }),
      );
      expect(stage.kind).toBe('club');
    }
  });

  it('desistiu: a apresentação de novo, quando a vez é dele', () => {
    const withdrawn = application({ status: 'withdrawn', canApply: true });
    expect(fanClubStageOf(mine({ application: withdrawn }))).toEqual({ kind: 'intro' });
    expect(
      fanClubStageOf(mine({ open: false, application: { ...withdrawn, canApply: false } })),
    ).toEqual({ kind: 'programClosed' });
  });

  it('recusada: o motivo e a próxima rodada', () => {
    const rejected = application({
      status: 'rejected',
      rejectReason: 'not_fit',
      canReapplyAt: '2026-11-17T15:00:00.000Z',
    });
    expect(fanClubStageOf(mine({ application: rejected }))).toEqual({
      kind: 'rejected',
      application: rejected,
      next: { kind: 'date', date: '2026-11-17T15:00:00.000Z' },
    });
  });

  it('o fã-clube encerrado continua no "Meu fã-clube", com a próxima rodada', () => {
    const closed = club({ status: 'closed', available: false, unavailableReason: 'closed' });
    const stage = fanClubStageOf(
      mine({ application: application({ status: 'approved' }), club: closed }),
    );
    expect(stage).toEqual({
      kind: 'club',
      application: expect.objectContaining({ status: 'approved' }),
      club: closed,
      next: { kind: 'never' },
    });
    // No ar, sem próxima rodada.
    const live = fanClubStageOf(
      mine({ application: application({ status: 'approved' }), club: club() }),
    );
    expect(live).toEqual(expect.objectContaining({ kind: 'club', next: null }));
  });

  it('aprovada sem o fã-clube (ele sumiu): só a próxima rodada', () => {
    const approved = application({ status: 'approved', canApply: true });
    expect(fanClubStageOf(mine({ application: approved }))).toEqual({
      kind: 'ended',
      application: approved,
      next: { kind: 'now' },
    });
  });
});

describe('nextRoundOf: quando vem a próxima candidatura', () => {
  const rejected = (patch: Partial<FanClubApplication>) =>
    application({ status: 'rejected', rejectReason: 'other', ...patch });

  it.each([
    ['a vez já chegou', rejected({ canApply: true }), true, { kind: 'now' }],
    ['o programa fechado', rejected({}), false, { kind: 'programClosed' }],
    [
      'o prazo de 30 dias',
      rejected({ canReapplyAt: '2026-11-17T15:00:00.000Z' }),
      true,
      { kind: 'date', date: '2026-11-17T15:00:00.000Z' },
    ],
    ['a 3ª rodada recusada, sem prazo', rejected({ round: 3 }), true, { kind: 'roundsOver' }],
    [
      'encerrado pela equipe: nunca mais',
      application({ status: 'approved' }),
      true,
      { kind: 'never' },
    ],
  ])('%s', (_name, item, open, expected) => {
    expect(nextRoundOf(mine({ open }), item)).toEqual(expected);
  });

  it('com o programa fechado, os fins vêm antes: a 3ª rodada e o encerrado pela equipe', () => {
    const closed = club({ status: 'closed', available: false, unavailableReason: 'closed' });
    expect(nextRoundOf(mine({ open: false }), rejected({ round: 3 }))).toEqual({
      kind: 'roundsOver',
    });
    expect(
      nextRoundOf(mine({ open: false, club: closed }), application({ status: 'approved' })),
    ).toEqual({ kind: 'never' });
    // O prazo com o programa fechado não diria nada de verdade.
    expect(
      nextRoundOf(mine({ open: false }), rejected({ canReapplyAt: '2026-11-17T15:00:00.000Z' })),
    ).toEqual({ kind: 'programClosed' });
  });
});

describe('canApplyNow', () => {
  it('sem candidatura, com o programa aberto; com ela, pela vez do servidor', () => {
    expect(canApplyNow(mine())).toBe(true);
    expect(canApplyNow(mine({ open: false }))).toBe(false);
    expect(canApplyNow(mine({ application: application({ canApply: true }) }))).toBe(true);
    expect(canApplyNow(mine({ application: application() }))).toBe(false);
  });
});

describe('hasNewPrize: "Novo prêmio" até o gestor abrir o "Meu fã-clube" (decisão 51)', () => {
  const rewarded = club({
    lastReward: { at: '2026-10-18T15:00:00.000Z', points: 200, prize: true },
  });

  it('sem reconhecimento, nada; sem marca, novo', () => {
    expect(hasNewPrize(club(), undefined)).toBe(false);
    expect(hasNewPrize(null, undefined)).toBe(false);
    expect(hasNewPrize(rewarded, undefined)).toBe(true);
  });

  it('visto, some; um mais novo, volta', () => {
    expect(hasNewPrize(rewarded, '2026-10-18T15:00:00.000Z')).toBe(false);
    expect(hasNewPrize(rewarded, '2026-10-01T15:00:00.000Z')).toBe(true);
  });
});

describe('settingsRowOf: a linha dos Ajustes (34.9, item 1)', () => {
  const approved = application({ status: 'approved' });

  it.each([
    ['sem candidatura', mine(), 'fanClub.settings.title', 'fanClub.settings.metaIntro'],
    [
      'em análise',
      mine({ application: application() }),
      'fanClub.settings.title',
      'fanClub.settings.metaPending',
    ],
    [
      'recusada',
      mine({ application: application({ status: 'rejected', rejectReason: 'other' }) }),
      'fanClub.settings.title',
      'fanClub.settings.metaRejected',
    ],
    [
      'fora do ar',
      mine({
        application: approved,
        club: club({ status: 'paused', available: false, unavailableReason: 'paused' }),
      }),
      'fanClub.settings.titleMine',
      'fanClub.settings.metaOff',
    ],
    [
      'encerrado',
      mine({
        application: approved,
        club: club({ status: 'closed', available: false, unavailableReason: 'closed' }),
      }),
      'fanClub.settings.titleMine',
      'fanClub.settings.metaOff',
    ],
  ])('%s', (_name, state, titleKey, metaKey) => {
    expect(settingsRowOf(state, false)).toEqual({ titleKey, metaKey });
  });

  it('no ar, "Seu fã-clube de {{artist}}"; com o prêmio novo, "Novo prêmio"', () => {
    const state = mine({ application: approved, club: club() });
    expect(settingsRowOf(state, false)).toEqual({
      titleKey: 'fanClub.settings.titleMine',
      metaKey: 'fanClub.settings.metaClub',
      artist: 'Netto Brito',
    });
    expect(settingsRowOf(state, true).metaKey).toBe('fanClub.settings.metaPrize');
  });
});

describe('a trava do que os fãs veem (etapa 8: a página, a 1d, a Início e os seguidos)', () => {
  const routeMissing = new ApiError('notFound', 'Não encontrado.', 404, 'not_found');
  const offline = new ApiError('network', 'Sem rede.', null, null);
  const rateLimited = new ApiError('rateLimited', 'Devagar.', 429, 'rate_limited');

  it('sem resposta ou com a `api` de antes (o 404), nada aparece', () => {
    expect(liveFanClub(undefined, null)).toBeNull();
    expect(liveFanClub(undefined, routeMissing)).toBeNull();
    // O 404 depois de uma resposta antiga (o servidor desfeito) também esconde.
    expect(liveFanClub(mine(), routeMissing)).toBeNull();
    expect(isDefinitiveRefusal(routeMissing)).toBe(true);
  });

  it('a falha incerta e o ritmo deixam a resposta que já estava', () => {
    expect(liveFanClub(mine(), offline)).toEqual(mine());
    expect(liveFanClub(mine(), rateLimited)).toEqual(mine());
    expect(isDefinitiveRefusal(offline)).toBe(false);
    expect(isDefinitiveRefusal(rateLimited)).toBe(false);
  });

  it('não olha o `open`: com o programa fechado, os fã-clubes que existem continuam (decisão 9)', () => {
    const closed = mine({ open: false });
    expect(liveFanClub(closed, null)).toEqual(closed);
    // A linha "Tenha seu fã-clube", sim: fechada para quem nunca se candidatou.
    expect(shownFanClub(closed, null)).toBeNull();
  });
});

describe('as frases do fã-clube na sheet "Sair da central" (34.9, item 11)', () => {
  const approved = application({ status: 'approved', canApply: false });

  it('antes da abertura, nenhuma', () => {
    expect(leaveCentralNotes(null, 'nettobrito')).toEqual([]);
  });

  it('quem sai deixa de seguir os fã-clubes do artista', () => {
    expect(leaveCentralNotes(mine(), 'nettobrito')).toEqual(['fanClub.leave.follows']);
  });

  it.each([
    ['ativo', 'active'],
    ['pausado', 'paused'],
  ] as const)('o gestor de um fã-clube %s deste artista fica sem publicar', (_name, status) => {
    const state = mine({ application: approved, club: club({ status }) });
    expect(leaveCentralNotes(state, 'nettobrito')).toEqual([
      'fanClub.leave.follows',
      'fanClub.leave.manager',
    ]);
  });

  it('o gestor de outro artista, o fã-clube encerrado e a candidatura em análise não ganham a frase', () => {
    const elsewhere = mine({ application: approved, club: club({ artistId: 'nenho' }) });
    const closed = mine({ application: approved, club: club({ status: 'closed' }) });
    const pending = mine({ application: application() });
    for (const state of [elsewhere, closed, pending]) {
      expect(leaveCentralNotes(state, 'nettobrito')).toEqual(['fanClub.leave.follows']);
    }
  });
});
