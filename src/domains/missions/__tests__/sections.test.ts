import { buildMissionsFixture } from '../fixtures';
import { buildMissionItems, missionsOfArtist, type MissionListItem } from '../sections';
import type { Mission } from '../types';

const NOW = new Date(2026, 8, 29, 20, 0);
const { missions } = buildMissionsFixture(NOW);

/** A lista como o fã lê: "label:today", "featured:m-...", "mission:m-...". */
const shape = (items: MissionListItem[]) =>
  items.map((item) =>
    item.type === 'label' ? `label:${item.section}` : `${item.type}:${item.key}`,
  );

describe('seções da 1g', () => {
  it('"Hoje" com a destacada no topo e "Esta semana" depois, na ordem do painel', () => {
    expect(shape(buildMissionItems(missions, NOW))).toEqual([
      'label:today',
      'featured:m-clipe-netto',
      'mission:m-curtir-nenho',
      'mission:m-comentar-central',
      'mission:m-relampago-show',
      'label:week',
      'mission:m-trazer-amigos',
      'mission:m-presenca-show',
    ]);
  });

  it('a destacada fica no topo da seção mesmo que o painel a mande depois', () => {
    const [featured, ...rest] = missions as [Mission, ...Mission[]];
    const reordered = [...rest, featured];
    expect(shape(buildMissionItems(reordered, NOW)).slice(0, 3)).toEqual([
      'label:today',
      'featured:m-clipe-netto',
      'mission:m-curtir-nenho',
    ]);
  });

  it('missão com o prazo vencido sai na hora; seção vazia some com a sobrelinha', () => {
    // A destacada vence 0h30 (4 h e meia depois das 20 h) e a de curtir, à meia-noite.
    const tomorrow = new Date(2026, 8, 30, 1, 0);
    // Amanhã, as de hoje que estavam abertas saem, e a concluída também (o
    // período dela acabou à meia-noite); a bloqueada fica até o servidor
    // tirá-la, e "Esta semana" segue.
    expect(shape(buildMissionItems(missions, tomorrow))).toEqual([
      'label:today',
      'mission:m-relampago-show',
      'label:week',
      'mission:m-trazer-amigos',
      'mission:m-presenca-show',
    ]);

    const weeklyOnly = missions.filter((mission) => mission.period === 'weekly');
    expect(shape(buildMissionItems(weeklyOnly, NOW))).toEqual([
      'label:week',
      'mission:m-trazer-amigos',
      'mission:m-presenca-show',
    ]);
  });

  it('expirada pelo servidor também sai', () => {
    const expired = missions.map((mission) =>
      mission.id === 'm-trazer-amigos' ? { ...mission, status: 'expired' as const } : mission,
    );
    expect(shape(buildMissionItems(expired, NOW))).not.toContain('mission:m-trazer-amigos');
  });

  it('sem missões, lista vazia', () => {
    expect(buildMissionItems([], NOW)).toEqual([]);
  });
});

describe('missões de uma central (aba Missões da 1d)', () => {
  it('só as que o painel ligou ao artista, na ordem dele', () => {
    expect(missionsOfArtist(missions, 'nettobrito').map((mission) => mission.id)).toEqual([
      'm-clipe-netto',
      'm-comentar-central',
      'm-relampago-show',
    ]);
    expect(missionsOfArtist(missions, 'nenho').map((mission) => mission.id)).toEqual([
      'm-curtir-nenho',
    ]);
  });

  it('central sem missão fica sem nenhuma', () => {
    expect(missionsOfArtist(missions, 'rocksalles')).toEqual([]);
  });
});
