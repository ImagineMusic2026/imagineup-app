import { buildInviteUrl, parseInviteLink } from '..';
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
    });
  });

  it('página que já tem parâmetro ganha o ref no fim, sem perder o que tinha', () => {
    const link = buildInviteUrl('CAMILA12', '/artista/nettobrito?aba=mural');
    expect(link).toBe(`${SHARE_LINK_BASE}/artista/nettobrito?aba=mural&ref=CAMILA12`);
    expect(parseInviteLink(link)).toEqual({
      code: 'CAMILA12',
      destination: '/artista/nettobrito?aba=mural',
    });
  });

  it('sem código (ainda carregando), sai o link puro, que continua abrindo a página', () => {
    expect(buildInviteUrl(null, 'post/p-clipe')).toBe(`${SHARE_LINK_BASE}/post/p-clipe`);
    expect(parseInviteLink(buildInviteUrl(null, '/post/p-clipe'))).toBeNull();
  });
});
