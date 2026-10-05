import {
  buildInviteUrl,
  invitePathForServer,
  inviteLinkId,
  normalizeInviteCode,
  parseInviteLink,
} from '..';
import { SHARE_LINK_BASE } from '../consts';

describe('link compartilhado com o convite do fã', () => {
  it('leva o código no ?ref= da página', () => {
    expect(buildInviteUrl('CAMILA12', '/post/p-clipe')).toBe(
      `${SHARE_LINK_BASE}/post/p-clipe?ref=CAMILA12`,
    );
  });

  it('do outro lado, o app lê o código e segue para a mesma página', () => {
    expect(parseInviteLink(buildInviteUrl('CAMILA12', '/post/p-clipe'))).toEqual({
      code: 'CAMILA12',
      destination: '/post/p-clipe',
      utm: {},
    });
  });

  it('página que já tem parâmetro ganha o ref no fim, sem perder o que tinha', () => {
    const link = buildInviteUrl('CAMILA12', '/artista/nettobrito?aba=mural');
    expect(link).toBe(`${SHARE_LINK_BASE}/artista/nettobrito?aba=mural&ref=CAMILA12`);
    expect(parseInviteLink(link)).toEqual({
      code: 'CAMILA12',
      destination: '/artista/nettobrito?aba=mural',
      utm: {},
    });
  });

  it('sem código (ainda carregando), sai o link puro, que continua abrindo a página', () => {
    expect(buildInviteUrl(null, 'post/p-clipe')).toBe(`${SHARE_LINK_BASE}/post/p-clipe`);
    expect(parseInviteLink(buildInviteUrl(null, '/post/p-clipe'))).toBeNull();
  });
});

// A mesma tabela de functions/src/invites/model.test.ts, no servidor: mudou
// uma, mude a outra.
describe('normalizeInviteCode (a mesma tabela do servidor)', () => {
  it.each([
    ['K7P3M9QX', 'K7P3M9QX'],
    ['k7p3m9qx', 'K7P3M9QX'],
    ['K7P3-M9QX', 'K7P3M9QX'],
    [' k7p3 m9qx ', 'K7P3M9QX'],
    ['camila12', 'CAMILA12'],
    ['abc_12', 'ABC_12'],
    ['ABC', 'ABC'],
  ])('%j vira %j', (raw, code) => {
    expect(normalizeInviteCode(raw)).toBe(code);
  });

  it.each([
    [''],
    ['ab'],
    ['a-b'],
    ['K7P3M9Q!'],
    ['straße'],
    ['ÇÃO123'],
    ['x'.repeat(65)],
    [null],
    [12345678],
  ])('%j não é código', (raw) => {
    expect(normalizeInviteCode(raw)).toBeNull();
  });
});

describe('o link no servidor', () => {
  it('um id por destino', () => {
    expect(inviteLinkId({ kind: 'invite' })).toBe('invite');
    expect(inviteLinkId({ kind: 'agenda' })).toBe('agenda');
    expect(inviteLinkId({ kind: 'post', postId: 'p-clipe' })).toBe('post:p-clipe');
    expect(inviteLinkId({ kind: 'artist', artistId: 'nettobrito' })).toBe('artist:nettobrito');
  });

  it('a base do servidor troca o domínio do link, sem build nova', () => {
    expect(buildInviteUrl('CAMILA12', '/post/p-clipe', 'https://imagineup.app/')).toBe(
      'https://imagineup.app/post/p-clipe?ref=CAMILA12',
    );
  });

  it('o caminho vai sem a busca, e / quando o servidor recusaria', () => {
    expect(invitePathForServer('/artista/netto?aba=agenda')).toBe('/artista/netto');
    expect(invitePathForServer('/post/p-clipe#x')).toBe('/post/p-clipe');
    expect(invitePathForServer('/a//b')).toBe('/');
    expect(invitePathForServer(`/${'x'.repeat(200)}`)).toBe('/');
    expect(invitePathForServer('/')).toBe('/');
  });
});
