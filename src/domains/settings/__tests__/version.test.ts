import { appVersionInfo, type VersionSources } from '../version';

// Meio do dia em UTC: "13 out" em qualquer fuso de -12 a +11.
const CREATED_AT = new Date('2026-10-13T12:00:00.000Z');
const UPDATE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('versão dos Ajustes (seção 29, decisão 17)', () => {
  it.each<[string, VersionSources, ReturnType<typeof appVersionInfo>]>([
    [
      'binário embutido, sem update baixado: só a versão',
      { version: '0.1.0', isEmbeddedLaunch: true, createdAt: CREATED_AT, updateId: UPDATE_ID },
      { version: '0.1.0', update: null },
    ],
    [
      'EAS Update: a versão, a data e o id curto',
      { version: '0.1.0', isEmbeddedLaunch: false, createdAt: CREATED_AT, updateId: UPDATE_ID },
      { version: '0.1.0', update: { date: '13 out', id: 'a1b2c3d4' } },
    ],
    [
      'Expo Go e desenvolvimento: data e id null, só a versão',
      { version: '0.1.0', isEmbeddedLaunch: false, createdAt: null, updateId: null },
      { version: '0.1.0', update: null },
    ],
    [
      'update sem id: só a versão',
      { version: '0.1.0', isEmbeddedLaunch: false, createdAt: CREATED_AT, updateId: null },
      { version: '0.1.0', update: null },
    ],
    [
      'sem a config do app',
      { version: undefined, isEmbeddedLaunch: true, createdAt: null, updateId: null },
      { version: null, update: null },
    ],
  ])('%s', (_, sources, expected) => {
    expect(appVersionInfo(sources)).toEqual(expected);
  });
});
