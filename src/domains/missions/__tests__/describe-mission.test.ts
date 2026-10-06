import {
  isMissionOver,
  missionHint,
  missionHref,
  missionLabel,
  missionMeta,
} from '../describe-mission';
import { buildMissionsFixture } from '../fixtures';
import type { Mission } from '../types';

// Hoje às 20 h: a missão de comentar foi concluída às 14:02, e o show sugerido
// é no dia 21 do mês seguinte (outubro).
const NOW = new Date(2026, 8, 29, 20, 0);
const { missions } = buildMissionsFixture(NOW);

function byId(id: string): Mission {
  const mission = missions.find((item) => item.id === id);
  if (!mission) throw new Error(`missão ${id} não existe nas fixtures`);
  return mission;
}

const CLIP = byId('m-clipe-netto');
const LIKE = byId('m-curtir-nenho');
const COMMENT = byId('m-comentar-central');
const FLASH = byId('m-relampago-show');
const INVITE = byId('m-trazer-amigos');
const RSVP = byId('m-presenca-show');

describe('linha de baixo do título', () => {
  it.each([
    ['link com régua', CLIP, '+2 por visita · +10 por cadastro'],
    ['progresso', LIKE, 'Você tem 2 de 5'],
    ['concluída', COMMENT, 'Concluída às 14:02'],
    ['bloqueada, com a dica do painel', FLASH, 'Abre quando o Netto subir no palco'],
    ['convite', INVITE, '1 de 3 cadastrados'],
    ['presença em show', RSVP, 'São João de Irará · 21 out'],
  ])('%s', (_what, mission, meta) => {
    expect(missionMeta(mission)).toBe(meta);
  });

  it('bloqueada sem dica e concluída sem hora têm texto de reserva', () => {
    expect(missionMeta({ ...FLASH, unlockHint: null })).toBe('Ainda não abriu');
    expect(missionMeta({ ...COMMENT, completedAt: null })).toBe('Concluída');
  });

  it('o progresso não passa da meta', () => {
    expect(missionMeta({ ...LIKE, progress: { current: 9, target: 5 } })).toBe('Você tem 5 de 5');
  });
});

describe('rótulo para o leitor de tela', () => {
  it.each([
    [
      'destaque com a régua do link',
      CLIP,
      'Leve 5 pessoas para o clipe novo do Netto. 3 de 5. Vale 20 pontos, 2 por visita e 10 por cadastro.',
    ],
    ['em andamento', LIKE, 'Curta 5 posts do Nenho. Você tem 2 de 5. Vale 10 pontos.'],
    ['concluída', COMMENT, 'Comente em 3 posts da central. Concluída às 14:02. Rendeu 20 pontos.'],
    [
      'bloqueada',
      FLASH,
      'Missão relâmpago do show. Bloqueada. Abre quando o Netto subir no palco. Vale 50 pontos.',
    ],
    ['convite', INVITE, 'Traga 3 amigos novos pro app. 1 de 3 cadastrados. Vale 30 pontos.'],
    [
      'presença, com a data por extenso',
      RSVP,
      'Confirme presença em um show. São João de Irará, 21 de outubro. Vale 15 pontos.',
    ],
  ])('%s', (_what, mission, label) => {
    expect(missionLabel(mission)).toBe(label);
  });

  it('um ponto só vai no singular', () => {
    expect(missionLabel({ ...LIKE, rewardPoints: 1 })).toBe(
      'Curta 5 posts do Nenho. Você tem 2 de 5. Vale 1 ponto.',
    );
  });
});

describe('para onde cada missão leva', () => {
  it.each([
    [
      'compartilhar um post abre o convite com o post (o "Gerar meu link" da home)',
      CLIP,
      { pathname: '/convidar', params: { missionId: CLIP.id, postId: 'p-clipe' } },
      'Abre seu link de convite',
    ],
    [
      'compartilhar sem post abre o convite',
      { ...CLIP, target: null },
      { pathname: '/convidar', params: { missionId: CLIP.id } },
      'Abre seu link de convite',
    ],
    [
      'convidar abre o convite',
      INVITE,
      { pathname: '/convidar', params: { missionId: INVITE.id } },
      'Abre seu link de convite',
    ],
    ['presença em show abre a agenda', RSVP, '/agenda', 'Abre a agenda'],
    [
      'curtir na central abre o artista, na aba de onde veio',
      LIKE,
      { pathname: '/artista/[artistaId]', params: { artistaId: 'nenho' } },
      'Abre a central do artista',
    ],
    [
      'comentar num post abre o post',
      { ...LIKE, action: 'comment' as const, target: { postId: 'p-show' } },
      { pathname: '/post/[postId]', params: { postId: 'p-show' } },
      'Abre o post',
    ],
    ['curtir sem alvo abre o início', { ...LIKE, target: null }, '/', 'Abre o início'],
  ])('%s', (_what, mission, href, hint) => {
    expect(missionHref(mission)).toEqual(href);
    expect(missionHint(mission)).toBe(hint);
  });

  it('concluída e bloqueada não levam a lugar nenhum', () => {
    for (const mission of [COMMENT, FLASH]) {
      expect(missionHref(mission)).toBeNull();
      expect(missionHint(mission)).toBeUndefined();
    }
  });
});

describe('missão vencida', () => {
  const later = new Date(new Date(CLIP.endsAt).getTime() + 1);
  // A concluída traz o fim do dia (o do período, como o servidor manda).
  const pastMidnight = new Date(new Date(COMMENT.endsAt).getTime() + 1);

  it.each([
    ['aberta com o prazo passado', CLIP, later, true],
    ['aberta dentro do prazo', CLIP, NOW, false],
    ['expirada pelo servidor', { ...LIKE, status: 'expired' as const }, NOW, true],
    ['concluída, até o período virar', COMMENT, NOW, false],
    ['concluída, depois de o período virar', COMMENT, pastMidnight, true],
    ['bloqueada, até o servidor dizer', { ...FLASH, endsAt: CLIP.endsAt }, later, false],
  ])('%s', (_what, mission, now, over) => {
    expect(isMissionOver(mission, now)).toBe(over);
  });
});

describe('entrar numa central e o link de uma central (bloco 7)', () => {
  const JOIN: Mission = {
    ...LIKE,
    id: 'm-entrar',
    title: 'Entre na central do Juninho',
    action: 'join',
    target: { artistId: 'juninhomoraes' },
    progress: { current: 0, target: 1 },
  };

  it('o join leva à central do alvo, com a dica da central', () => {
    expect(missionHref(JOIN)).toEqual({
      pathname: '/artista/[artistaId]',
      params: { artistaId: 'juninhomoraes' },
    });
    expect(missionHint(JOIN)).toBe('Abre a central do artista');
    expect(missionMeta(JOIN)).toBe('Você tem 0 de 1');
  });

  it('sem a central (o servidor sempre manda), o join não leva a lugar nenhum', () => {
    expect(missionHref({ ...JOIN, target: null })).toBeNull();
    expect(missionHint({ ...JOIN, target: null })).toBeUndefined();
  });

  it('o link com alvo de central, sem post, leva a central à sheet do convite', () => {
    const share: Mission = { ...CLIP, id: 'm-link', target: { artistId: 'nettobrito' } };
    expect(missionHref(share)).toEqual({
      pathname: '/convidar',
      params: { missionId: 'm-link', artistId: 'nettobrito' },
    });
    // Com post, o post vence (o link leva a ele).
    expect(missionHref(CLIP)).toEqual({
      pathname: '/convidar',
      params: { missionId: 'm-clipe-netto', postId: 'p-clipe' },
    });
  });
});
