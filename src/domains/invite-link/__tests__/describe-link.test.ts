import {
  describeInviteLink,
  inviteMessage,
  inviteTargetPath,
  inviteTargetText,
  type InviteTarget,
} from '../describe-link';

// O caminho do post vem do domínio dos posts, que puxa a API e o Firebase.
jest.mock('@/domains/posts', () => ({
  postPath: (postId: string) => `/post/${encodeURIComponent(postId)}`,
}));

const POST: InviteTarget = { kind: 'post', postId: 'p-clipe', artistName: 'Netto Brito' };
const POST_LOADING: InviteTarget = { kind: 'post', postId: 'p-clipe', artistName: null };
const EVENT: InviteTarget = { kind: 'event', showTitle: 'São João de Irará' };
const EVENT_UNKNOWN: InviteTarget = { kind: 'event', showTitle: null };
const APP: InviteTarget = { kind: 'app' };

describe('link do convite', () => {
  it.each<[string, InviteTarget, string]>([
    ['o post leva ao próprio post', POST, '/post/p-clipe'],
    ['o show leva à agenda, que não tem página de um show só', EVENT, '/agenda'],
    ['o atalho do "+" leva ao app', APP, '/'],
  ])('%s', (_name, target, path) => {
    expect(inviteTargetPath(target)).toBe(path);
  });

  it.each<[string, InviteTarget, string]>([
    ['post com o artista', POST, 'Leva para o post de Netto Brito.'],
    ['post antes de o artista chegar', POST_LOADING, 'Leva para o post.'],
    ['show com o nome', EVENT, 'Leva para a agenda de shows: São João de Irará.'],
    ['show fora das páginas carregadas', EVENT_UNKNOWN, 'Leva para a agenda de shows.'],
    ['app', APP, 'Leva para o ImagineUP.'],
  ])('diz para onde leva: %s', (_name, target, text) => {
    expect(inviteTargetText(target)).toBe(text);
  });

  it.each<[string, InviteTarget, string]>([
    ['post', POST, 'Olha esse post de Netto Brito no ImagineUP'],
    ['show', EVENT, 'Vamos juntos? São João de Irará está na agenda do ImagineUP'],
    [
      'show sem nome',
      EVENT_UNKNOWN,
      'Vem pro ImagineUP, a central de fãs dos artistas da Imagine Music',
    ],
    ['app', APP, 'Vem pro ImagineUP, a central de fãs dos artistas da Imagine Music'],
  ])('a mensagem que vai junto: %s', (_name, target, message) => {
    expect(inviteMessage(target)).toBe(message);
  });

  it('leva o código do fã no ?ref= e mostra o endereço sem o https', () => {
    const link = describeInviteLink(POST, 'CAMILA12');
    expect(link.url).toBe('https://imagineup-painel.vercel.app/post/p-clipe?ref=CAMILA12');
    expect(link.display).toBe('imagineup-painel.vercel.app/post/p-clipe?ref=CAMILA12');
  });

  it('o leitor de tela ouve o código e o destino, não o endereço soletrado', () => {
    expect(describeInviteLink(APP, 'CAMILA12').accessibilityLabel).toBe(
      'Seu link, com o seu código de convite, CAMILA12. Leva para o ImagineUP.',
    );
  });

  it('sem o código, o link sai puro e o leitor de tela fica sabendo', () => {
    const link = describeInviteLink(EVENT, null);
    expect(link.url).toBe('https://imagineup-painel.vercel.app/agenda');
    expect(link.accessibilityLabel).toBe(
      'Seu link, ainda sem o seu código de convite. Leva para a agenda de shows: São João de Irará.',
    );
  });
});
