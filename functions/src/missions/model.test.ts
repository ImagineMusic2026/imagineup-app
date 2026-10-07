import { describe, expect, it } from 'vitest';

import { ConfigValidationError } from '../config-validation';
import {
  applyMissionTicks,
  candidateMissions,
  dailyMissionOf,
  draftMissionId,
  emptyMissionsState,
  itemNow,
  keyDigest,
  missionArtistId,
  missionEnd,
  missionIndex,
  MissionsError,
  missionsView,
  parseMissionsConfig,
  periodEndOf,
  periodKeyOf,
  rollMissions,
  seasonGoalView,
  validateMissionChanges,
  validateMissionInput,
  validateSeasonGoalInput,
  visibleCandidates,
  type MissionRecord,
  type MissionsState,
  type MissionTick,
  type TargetFacts,
} from './model';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// Segunda-feira, 5 de outubro de 2026, meio-dia em São Paulo (semana 2026-W41).
const NOW = Date.parse('2026-10-05T15:00:00.000Z');

function mission(extra: Partial<MissionRecord> = {}): MissionRecord {
  return {
    id: 'm-curtir-nenho',
    title: 'Curta 5 posts do Nenho',
    action: 'like',
    target: { postId: null, artistId: 'nenho', eventId: null },
    goal: 5,
    period: 'daily',
    rewardPoints: 10,
    featured: false,
    startsAt: NOW - DAY_MS,
    endsAt: null,
    status: 'active',
    activatedAt: NOW - DAY_MS,
    createdAt: NOW - DAY_MS,
    updatedAt: NOW - DAY_MS,
    ...extra,
  };
}

const CLIPE = mission({
  id: 'm-clipe-netto',
  title: 'Leve 5 pessoas para o clipe novo do Netto',
  action: 'share',
  target: { postId: 'p-clipe', artistId: 'nettobrito', eventId: null },
  rewardPoints: 20,
  featured: true,
});
const CURTIR = mission();
const COMENTAR = mission({
  id: 'm-comentar-central',
  title: 'Comente em 3 posts da central',
  action: 'comment',
  target: { postId: null, artistId: 'nettobrito', eventId: null },
  goal: 3,
  rewardPoints: 20,
});
const AMIGOS = mission({
  id: 'm-trazer-amigos',
  title: 'Traga 3 amigos novos pro app',
  action: 'invite',
  target: null,
  goal: 3,
  period: 'weekly',
  rewardPoints: 30,
});
const SHOW = mission({
  id: 'm-presenca-show',
  title: 'Confirme presença em um show',
  action: 'rsvp',
  target: { postId: null, artistId: null, eventId: 'sao-joao-irara' },
  goal: 1,
  period: 'weekly',
  rewardPoints: 15,
});

const like = (postId: string, artistId: string): MissionTick => ({
  action: 'like',
  key: postId,
  on: { postId, artistIds: [artistId] },
});

const silent = { error: () => undefined };

describe('catálogo: leitura tolerante', () => {
  const raw = (extra: Record<string, unknown> = {}) => ({
    ...CURTIR,
    startsAt: { toMillis: () => CURTIR.startsAt },
    ...extra,
  });

  it('documento ausente é o catálogo vazio, versão 0 e sem meta', () => {
    expect(parseMissionsConfig(undefined, silent)).toEqual({
      version: 0,
      missions: [],
      seasonGoal: null,
    });
  });

  it('a missão fora do formato sai, com erro no log, e as outras ficam', () => {
    const errors: string[] = [];
    const config = parseMissionsConfig(
      {
        version: 3,
        missions: [raw(), raw({ id: 'm-x', goal: 0 }), raw({ id: 'm-y', status: 'archived' })],
      },
      { error: (message) => errors.push(message) },
    );
    expect(config.version).toBe(3);
    expect(config.missions.map((item) => item.id)).toEqual(['m-curtir-nenho']);
    expect(config.missions[0]!.startsAt).toBe(CURTIR.startsAt);
    expect(errors).toHaveLength(2);
  });

  it.each([
    ['o alvo que o tipo não aceita (join sem central)', { action: 'join', target: null }],
    ['meta diferente de 1 no alvo único', { target: { postId: 'p1', artistId: 'nenho' } }],
    ['título invisível', { title: '​' }],
    ['recompensa 0', { rewardPoints: 0 }],
    ['fim antes do início', { endsAt: CURTIR.startsAt - 1 }],
    ['id repetido fica o primeiro', null],
  ])('%s sai do catálogo', (_name, extra) => {
    const missions =
      extra === null ? [raw(), raw({ title: 'Outra' })] : [raw(), raw({ id: 'm-z', ...extra })];
    const config = parseMissionsConfig({ version: 1, missions }, silent);
    expect(config.missions).toHaveLength(1);
    expect(config.missions[0]!.title).toBe('Curta 5 posts do Nenho');
  });

  it('a meta inválida vira null, e a válida fica', () => {
    const goal = {
      seasonId: 'temporada-sao-joao',
      title: 'Semana do arrocha',
      description: 'Complete 20 missões.',
      reachedDescription: null,
      metric: 'missions',
      target: 20,
    };
    expect(
      parseMissionsConfig({ version: 1, missions: [], seasonGoal: goal }, silent).seasonGoal,
    ).toEqual(goal);
    expect(
      parseMissionsConfig({ version: 1, missions: [], seasonGoal: { ...goal, target: 0 } }, silent)
        .seasonGoal,
    ).toBeNull();
  });

  it('documento fora do formato vale o catálogo vazio', () => {
    expect(parseMissionsConfig('x', silent).missions).toEqual([]);
  });
});

describe('catálogo: validação estrita do painel', () => {
  const input = (extra: Record<string, unknown> = {}) => ({
    title: 'Curta 5 posts do Nenho',
    action: 'like',
    target: { artistId: 'nenho' },
    goal: 5,
    period: 'daily',
    rewardPoints: 10,
    featured: false,
    startsAt: NOW,
    endsAt: null,
    ...extra,
  });

  it('a missão inteira, normalizada', () => {
    expect(validateMissionInput(input())).toMatchObject({
      target: { postId: null, artistId: 'nenho', eventId: null },
      goal: 5,
    });
  });

  it.each([
    ['title', { title: '' }],
    ['goal', { goal: 51 }],
    ['rewardPoints', { rewardPoints: 10_001 }],
    ['period', { period: 'monthly' }],
    ['featured', { featured: 'sim' }],
    ['endsAt', { endsAt: NOW - 1 }],
    ['endsAt', { endsAt: NOW + 367 * DAY_MS }],
    ['extra', { extra: 1 }],
  ])('campo errado (%s) recusa com o caminho dele', (field, extra) => {
    let error: unknown;
    try {
      validateMissionInput(input(extra));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigValidationError);
    expect((error as ConfigValidationError).field).toBe(`mission.${field}`);
  });

  it.each([
    ['join sem central', { action: 'join', target: null }],
    ['invite com central', { action: 'invite' }],
    ['rsvp com post', { action: 'rsvp', target: { postId: 'p1' } }],
    ['post com show', { target: { postId: 'p1', eventId: 's1' } }],
    ['share com show', { action: 'share', target: { eventId: 's1' } }],
  ])('%s é invalid-target', (_name, extra) => {
    expect(() => validateMissionInput(input(extra))).toThrow(MissionsError);
  });

  it.each([
    ['like', { postId: 'p1' }],
    ['comment', { postId: 'p1' }],
    ['rsvp', { eventId: 's1' }],
    ['join', { artistId: 'nenho' }],
  ])('alvo único em %s pede meta 1', (action, target) => {
    expect(() => validateMissionInput(input({ action, target, goal: 2 }))).toThrow(/mission\.goal/);
    expect(validateMissionInput(input({ action, target, goal: 1 })).goal).toBe(1);
  });

  it('no alvo de post, a central do pedido é ignorada (o servidor grava a do post)', () => {
    expect(
      validateMissionInput(input({ target: { postId: 'p1', artistId: 'outra' }, goal: 1 })).target,
    ).toEqual({ postId: 'p1', artistId: null, eventId: null });
  });

  it('as mudanças conferem só o que veio', () => {
    expect(validateMissionChanges({ title: 'Novo', rewardPoints: 30 })).toEqual({
      title: 'Novo',
      rewardPoints: 30,
    });
    expect(() => validateMissionChanges({ goal: 0 })).toThrow(/mission\.goal/);
  });

  it('a meta da temporada, estrita', () => {
    expect(validateSeasonGoalInput(null)).toBeNull();
    const goal = {
      title: 'Semana do arrocha',
      description: 'Complete 20 missões.',
      reachedDescription: 'Lote garantido.',
      metric: 'points',
      target: 5_000,
    };
    expect(validateSeasonGoalInput(goal)).toEqual(goal);
    expect(() => validateSeasonGoalInput({ ...goal, metric: 'missions' })).toThrow(/goal\.target/);
    expect(() => validateSeasonGoalInput({ ...goal, reachedDescription: '' })).toThrow(
      /reachedDescription/,
    );
  });

  it('o id gerado: o título em slug, sem acento, mais 4 caracteres sorteados', () => {
    expect(draftMissionId('Leve 5 pessoas para o clipe novo do Netto', () => 0)).toBe(
      'leve-5-pessoas-para-o-clipe-no-aaaa',
    );
    expect(draftMissionId('São João!', () => 0.99)).toBe('sao-joao-9999');
    expect(draftMissionId('!!', () => 0)).toBe('missao-aaaa');
  });
});

describe('índice e candidatas', () => {
  const index = missionIndex({
    version: 2,
    missions: [
      CLIPE,
      CURTIR,
      COMENTAR,
      AMIGOS,
      SHOW,
      mission({ id: 'm-rascunho', status: 'draft' }),
    ],
  });

  it('o índice guarda só as missões no ar, por tipo', () => {
    expect(index.byAction.get('like')!.map((item) => item.id)).toEqual(['m-curtir-nenho']);
    expect(index.byAction.has('join')).toBe(false);
    expect(index.shareWithCentral).toBe(false);
    expect(
      missionIndex({
        version: 1,
        missions: [
          mission({
            id: 'm-link',
            action: 'share',
            target: { postId: null, artistId: 'nettobrito', eventId: null },
          }),
        ],
      }).shareWithCentral,
    ).toBe(true);
  });

  it.each([
    ['curtida na central do alvo', [like('p1', 'nenho')], ['m-curtir-nenho']],
    ['curtida em outra central', [like('p1', 'nettobrito')], []],
    [
      'link do post alvo, sem a central',
      [{ action: 'share', key: 'e1', on: { postId: 'p-clipe', artistIds: [] } }],
      ['m-clipe-netto'],
    ],
    [
      'link de outro post da central do alvo de post',
      [{ action: 'share', key: 'e1', on: { postId: 'p2', artistIds: ['nettobrito'] } }],
      [],
    ],
    [
      '"Eu vou" no show alvo',
      [{ action: 'rsvp', key: 'sao-joao-irara', on: { eventId: 'sao-joao-irara', artistIds: [] } }],
      ['m-presenca-show'],
    ],
    [
      '"Eu vou" em outro show',
      [{ action: 'rsvp', key: 'outro', on: { eventId: 'outro', artistIds: ['nenho'] } }],
      [],
    ],
    [
      'convite sem alvo',
      [{ action: 'invite', key: 'e1', on: { artistIds: [] } }],
      ['m-trazer-amigos'],
    ],
  ] as [string, MissionTick[], string[]][])('%s', (_name, ticks, ids) => {
    expect(candidateMissions(index, ticks, NOW).map((item) => item.id)).toEqual(ids);
  });

  it('fora da janela não conta: antes do início, depois do fim', () => {
    const late = missionIndex({ version: 1, missions: [mission({ startsAt: NOW + 1 })] });
    const ended = missionIndex({ version: 1, missions: [mission({ endsAt: NOW })] });
    expect(candidateMissions(late, [like('p1', 'nenho')], NOW)).toEqual([]);
    expect(candidateMissions(ended, [like('p1', 'nenho')], NOW)).toEqual([]);
  });
});

describe('períodos', () => {
  it('as chaves do dia e da semana de São Paulo', () => {
    expect(periodKeyOf('daily', NOW)).toBe('2026-10-05');
    expect(periodKeyOf('weekly', NOW)).toBe('2026-W41');
    // Domingo 23:59 de São Paulo ainda é a semana W41.
    expect(periodKeyOf('weekly', Date.parse('2026-10-12T02:59:00.000Z'))).toBe('2026-W41');
    expect(periodKeyOf('weekly', Date.parse('2026-10-12T03:00:00.000Z'))).toBe('2026-W42');
  });

  it('o fim da aberta é o menor entre o endsAt e o fim do período', () => {
    expect(new Date(periodEndOf('daily', NOW)).toISOString()).toBe('2026-10-06T03:00:00.000Z');
    expect(new Date(periodEndOf('weekly', NOW)).toISOString()).toBe('2026-10-12T03:00:00.000Z');
    expect(missionEnd(mission({ endsAt: NOW + HOUR_MS }), NOW)).toBe(NOW + HOUR_MS);
    expect(missionEnd(mission({ endsAt: NOW + 3 * DAY_MS }), NOW)).toBe(
      Date.parse('2026-10-06T03:00:00.000Z'),
    );
  });

  it('a chave anterior à do pedido vira um período vazio; a posterior fica e descarta os ticks', () => {
    const state: MissionsState = {
      daily: {
        key: '2026-10-04',
        items: { a: { current: 3, keys: [], completedAt: null, rewardPaid: 0 } },
      },
      weekly: {
        key: '2026-W42',
        items: { b: { current: 1, keys: [], completedAt: null, rewardPaid: 0 } },
      },
    };
    const rolled = rollMissions(state, NOW);
    expect(rolled.state.daily).toEqual({ key: '2026-10-05', items: {} });
    expect(rolled.state.weekly!.key).toBe('2026-W42');
    expect(rolled.stale).toEqual({ daily: false, weekly: true });
    // A lida não muda.
    expect(state.daily!.key).toBe('2026-10-04');
  });
});

describe('progresso', () => {
  const rolled = () => rollMissions(emptyMissionsState(), NOW);

  it('conta, conclui na meta e devolve a conclusão no período', () => {
    const ticks = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => like(id, 'nenho'));
    const applied = applyMissionTicks(rolled(), [CURTIR], ticks, NOW);
    expect(applied.counted).toBe(true);
    expect(applied.completions).toEqual([{ mission: CURTIR, periodKey: '2026-10-05' }]);
    const item = applied.state.daily!.items['m-curtir-nenho']!;
    expect(item).toMatchObject({ current: 5, completedAt: NOW, rewardPaid: 0 });
    expect(item.keys).toHaveLength(5);
  });

  it('o mesmo alvo no mesmo período não conta de novo (curtir, descurtir e curtir de novo)', () => {
    const once = applyMissionTicks(rolled(), [CURTIR], [like('p1', 'nenho')], NOW);
    const again = applyMissionTicks(
      { state: once.state, stale: { daily: false, weekly: false } },
      [CURTIR],
      [like('p1', 'nenho'), like('p1', 'nenho')],
      NOW,
    );
    expect(again.counted).toBe(false);
    expect(again.state.daily!.items['m-curtir-nenho']!.current).toBe(1);
  });

  it('noutro dia, o mesmo post conta de novo, do zero', () => {
    const today = applyMissionTicks(rolled(), [CURTIR], [like('p1', 'nenho')], NOW);
    const tomorrow = NOW + DAY_MS;
    const next = applyMissionTicks(
      rollMissions(today.state, tomorrow),
      [CURTIR],
      [like('p1', 'nenho')],
      tomorrow,
    );
    expect(next.state.daily).toMatchObject({ key: '2026-10-06' });
    expect(next.state.daily!.items['m-curtir-nenho']!.current).toBe(1);
  });

  it('concluída não anda; comentar no mesmo post conta um, em posts diferentes conclui', () => {
    const comment = (postId: string): MissionTick => ({
      action: 'comment',
      key: postId,
      on: { postId, artistIds: ['nettobrito'] },
    });
    const same = applyMissionTicks(rolled(), [COMENTAR], [comment('p1'), comment('p1')], NOW);
    expect(same.state.daily!.items['m-comentar-central']!.current).toBe(1);
    const done = applyMissionTicks(
      rolled(),
      [COMENTAR],
      [comment('p1'), comment('p2'), comment('p3'), comment('p4')],
      NOW,
    );
    expect(done.completions).toHaveLength(1);
    expect(done.state.daily!.items['m-comentar-central']!.current).toBe(3);
  });

  it('share e invite contam a pessoa sem guardar a chave dela', () => {
    const applied = applyMissionTicks(
      rolled(),
      [AMIGOS],
      [{ action: 'invite', key: 'e-pessoa', on: { artistIds: [] } }],
      NOW,
    );
    expect(applied.state.weekly!.items['m-trazer-amigos']).toEqual({
      current: 1,
      keys: [],
      completedAt: null,
      rewardPaid: 0,
    });
  });

  it('o tick do período velho é descartado', () => {
    const future = rollMissions({ daily: { key: '2026-10-06', items: {} }, weekly: null }, NOW);
    const applied = applyMissionTicks(future, [CURTIR], [like('p1', 'nenho')], NOW);
    expect(applied.counted).toBe(false);
    expect(applied.completions).toEqual([]);
  });

  it('o resumo do alvo: 12 caracteres, estável', () => {
    expect(keyDigest('p-clipe')).toHaveLength(12);
    expect(keyDigest('p-clipe')).toBe(keyDigest('p-clipe'));
    expect(keyDigest('p-clipe')).not.toBe(keyDigest('p-show'));
  });

  it('a central que a conclusão paga', () => {
    expect(missionArtistId(CURTIR)).toBe('nenho');
    expect(missionArtistId(CLIPE)).toBeNull();
    expect(missionArtistId(SHOW)).toBeNull();
    expect(missionArtistId(AMIGOS)).toBeNull();
    expect(
      missionArtistId(
        mission({ target: { postId: 'p1', artistId: 'nenho', eventId: null }, goal: 1 }),
      ),
    ).toBe('nenho');
  });
});

describe('a 1g (missionsView)', () => {
  const facts = (extra: Partial<TargetFacts> = {}): TargetFacts => ({
    posts: new Map([['p-clipe', true]]),
    events: new Map([
      ['sao-joao-irara', { open: true, title: 'São João de Irará', startsAt: NOW + 30 * DAY_MS }],
    ]),
    artists: new Map([
      ['nenho', true],
      ['nettobrito', true],
    ]),
    done: new Set(),
    ...extra,
  });
  const breakdown = { perVisit: 2, perSignup: 10 };
  const view = (missions: MissionRecord[], state: MissionsState, f = facts(), now = NOW) =>
    missionsView({ candidates: visibleCandidates(missions, state, now), facts: f, now, breakdown });
  const state = (daily: Record<string, object> = {}, weekly: Record<string, object> = {}) =>
    ({
      daily: {
        key: '2026-10-05',
        items: Object.fromEntries(
          Object.entries(daily).map(([id, item]) => [
            id,
            { current: 0, keys: [], completedAt: null, rewardPaid: 0, ...item },
          ]),
        ),
      },
      weekly: {
        key: '2026-W41',
        items: Object.fromEntries(
          Object.entries(weekly).map(([id, item]) => [
            id,
            { current: 0, keys: [], completedAt: null, rewardPaid: 0, ...item },
          ]),
        ),
      },
    }) as MissionsState;

  it('o progresso só com a chave do período de agora', () => {
    const old: MissionsState = {
      daily: {
        key: '2026-10-04',
        items: { 'm-curtir-nenho': { current: 4, keys: [], completedAt: null, rewardPaid: 0 } },
      },
      weekly: null,
    };
    expect(view([CURTIR], old)[0]!.progress).toEqual({ current: 0, target: 5 });
    expect(view([CURTIR], state({ 'm-curtir-nenho': { current: 2 } }))[0]!.progress).toEqual({
      current: 2,
      target: 5,
    });
    expect(itemNow(old, CURTIR, NOW)).toBeNull();
  });

  it('a missão do protótipo, no formato do app', () => {
    const [clipe] = view([CLIPE], state({ 'm-clipe-netto': { current: 3 } }));
    expect(clipe).toEqual({
      id: 'm-clipe-netto',
      title: 'Leve 5 pessoas para o clipe novo do Netto',
      rewardPoints: 20,
      progress: { current: 3, target: 5 },
      endsAt: '2026-10-06T03:00:00.000Z',
      status: 'active',
      action: 'share',
      target: { postId: 'p-clipe', artistId: 'nettobrito' },
      period: 'daily',
      featured: true,
      pointsBreakdown: { perVisit: 2, perSignup: 10 },
      completedAt: null,
      unlockHint: null,
      event: null,
    });
  });

  it('a concluída fica depois do endsAt até o fim do período, com a recompensa paga', () => {
    const ending = mission({ endsAt: NOW + HOUR_MS, rewardPoints: 40 });
    const done = state({ 'm-curtir-nenho': { current: 5, completedAt: NOW, rewardPaid: 10 } });
    const later = NOW + 2 * HOUR_MS;
    const [item] = view([ending], done, facts(), later);
    expect(item).toMatchObject({ status: 'completed', rewardPoints: 10 });
    expect(item!.completedAt).toBe(new Date(NOW).toISOString());
    // O fim que o app recebe é o do período (a meia-noite de São Paulo), e
    // não o endsAt do catálogo: é quando ela sai da tela.
    expect(item!.endsAt).toBe('2026-10-06T03:00:00.000Z');
    // Aberta, a mesma missão já some depois do endsAt.
    expect(view([ending], state(), facts(), later)).toEqual([]);
  });

  it('a concluída que saiu duplicate mostra a recompensa do catálogo, nunca +0', () => {
    const done = state({ 'm-curtir-nenho': { current: 5, completedAt: NOW, rewardPaid: 0 } });
    expect(view([CURTIR], done)[0]!.rewardPoints).toBe(10);
  });

  it('alvo invisível esconde a aberta e não a concluída', () => {
    const off = facts({ posts: new Map([['p-clipe', false]]) });
    expect(view([CLIPE], state(), off)).toEqual([]);
    const done = state({ 'm-clipe-netto': { current: 5, completedAt: NOW, rewardPaid: 20 } });
    expect(view([CLIPE], done, off)).toHaveLength(1);
    const ended = facts({
      events: new Map([['sao-joao-irara', { open: false, title: 'x', startsAt: NOW }]]),
    });
    expect(view([SHOW], state(), ended)).toEqual([]);
    expect(view([CURTIR], state(), facts({ artists: new Map([['nenho', false]]) }))).toEqual([]);
  });

  it('o alvo único já feito esconde a aberta (quem já vai ao show)', () => {
    expect(view([SHOW], state(), facts({ done: new Set(['m-presenca-show']) }))).toEqual([]);
    expect(view([SHOW], state())[0]!.event).toEqual({
      name: 'São João de Irará',
      startsAt: new Date(NOW + 30 * DAY_MS).toISOString(),
    });
  });

  it('o destaque é a primeira visível de cada período, aberta ou concluída', () => {
    const second = mission({ id: 'm-outra', featured: true });
    const weeklyFeatured = mission({ ...AMIGOS, featured: true });
    const off = facts({ posts: new Map([['p-clipe', false]]) });
    const missions = view([CLIPE, second, weeklyFeatured], state(), off);
    expect(missions.map((item) => [item.id, item.featured])).toEqual([
      ['m-outra', true],
      ['m-trazer-amigos', true],
    ]);
    const done = state({ 'm-clipe-netto': { current: 5, completedAt: NOW, rewardPaid: 20 } });
    const kept = view([CLIPE, second], done, off);
    expect(kept.map((item) => [item.id, item.featured])).toEqual([
      ['m-clipe-netto', true],
      ['m-outra', false],
    ]);
    expect(dailyMissionOf(kept)!.id).toBe('m-clipe-netto');
  });

  it('pointsBreakdown só no share; rascunho e antes do início ficam de fora', () => {
    expect(view([CURTIR], state())[0]!.pointsBreakdown).toBeNull();
    expect(view([mission({ status: 'draft' })], state())).toEqual([]);
    expect(view([mission({ startsAt: NOW + 1 })], state())).toEqual([]);
  });
});

describe('meta da temporada', () => {
  const goal = {
    seasonId: 'temporada-sao-joao',
    title: 'Semana do arrocha',
    description: 'Complete 20 missões e garanta um lote de ingressos do São João.',
    reachedDescription: 'Meta cumprida: seu lote está garantido.',
    metric: 'missions' as const,
    target: 20,
  };
  const season = { id: 'temporada-sao-joao', endsAt: NOW + 12 * DAY_MS };

  it('por missões, com o texto de sempre até cumprir', () => {
    expect(
      seasonGoalView({
        goal,
        season,
        seasonMissions: 12,
        seasonPoints: 4_120,
        goalReachedSeasonId: null,
      }),
    ).toEqual({
      id: 'temporada-sao-joao',
      title: 'Semana do arrocha',
      description: goal.description,
      completedCount: 12,
      targetCount: 20,
      endsAt: new Date(season.endsAt).toISOString(),
      metric: 'missions',
    });
  });

  it('cumprida pela marca ou pela conta, com o texto do prêmio', () => {
    const marked = seasonGoalView({
      goal,
      season,
      seasonMissions: 3,
      seasonPoints: 0,
      goalReachedSeasonId: season.id,
    });
    expect(marked!.description).toBe(goal.reachedDescription);
    const byPoints = seasonGoalView({
      goal: { ...goal, metric: 'points', target: 4_000, reachedDescription: null },
      season,
      seasonMissions: 0,
      seasonPoints: 4_120,
      goalReachedSeasonId: null,
    });
    expect(byPoints).toMatchObject({ completedCount: 4_120, description: goal.description });
  });

  it('sem temporada ativa, ou de outro id, null', () => {
    const args = { seasonMissions: 1, seasonPoints: 1, goalReachedSeasonId: null };
    expect(seasonGoalView({ goal, season: null, ...args })).toBeNull();
    expect(seasonGoalView({ goal, season: { ...season, id: 'outra' }, ...args })).toBeNull();
    expect(seasonGoalView({ goal: null, season, ...args })).toBeNull();
  });
});
