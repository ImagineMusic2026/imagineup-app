import { formatDayKey, nextRoundText } from '../format';
import { applySchema, postSchema, type ApplyFormInput } from '../schemas';

// Os formulários do fã-clube com as regras do servidor (34.5): o aparelho
// confere antes, para o fã ver o erro no campo.

jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));

const VALID: ApplyFormInput = {
  artistId: 'nettobrito',
  name: '  Netto de Coração ',
  instagram: '@Camila.Teste.Up',
  tiktok: '',
  whatsapp: '(75) 99123-4567',
  pitch: 'Vou divulgar nos meus perfis e no grupo dos fãs.',
  adult: true,
  rules: true,
};

/** As mensagens do envio, por campo. */
function errorsOf(input: ApplyFormInput): Record<string, string> {
  const result = applySchema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((issue) => [issue.path[0], issue.message]));
}

describe('applySchema: a candidatura', () => {
  it('limpa o nome, normaliza as redes e guarda o WhatsApp no formato do servidor', () => {
    expect(applySchema.parse(VALID)).toEqual({
      artistId: 'nettobrito',
      name: 'Netto de Coração',
      instagram: 'camila.teste.up',
      tiktok: null,
      whatsapp: '+5575991234567',
      pitch: 'Vou divulgar nos meus perfis e no grupo dos fãs.',
      adult: true,
      rules: true,
    });
  });

  it('o nome: de 3 a 40, e a palavra oficial recusada em qualquer caixa e acento', () => {
    expect(errorsOf({ ...VALID, name: 'NB' }).name).toBe(
      'O nome precisa ter de 3 a 40 caracteres.',
    );
    expect(errorsOf({ ...VALID, name: 'x'.repeat(41) }).name).toBeDefined();
    expect(errorsOf({ ...VALID, name: 'x'.repeat(40) }).name).toBeUndefined();
    expect(errorsOf({ ...VALID, name: 'Fã-clube OFICIÁL do Netto' }).name).toBe(
      'O nome não pode ter a palavra oficial. Só a equipe oficializa um fã-clube, com o selo.',
    );
    // "oficialmente" não é a palavra inteira, como no servidor.
    expect(errorsOf({ ...VALID, name: 'Netto oficialmente' }).name).toBeUndefined();
    expect(errorsOf({ ...VALID, name: 'Netto-oficial' }).name).toBeDefined();
    // Os @ $ ! | são letras no filtro do servidor, que aceita estes: o aparelho também.
    for (const name of ['Clube!Oficial', 'Fãs@oficial', 'Netto|oficial', 'Clube$oficial']) {
      expect([name, errorsOf({ ...VALID, name }).name]).toEqual([name, undefined]);
    }
  });

  it('o texto de divulgação: de 20 a 1.000', () => {
    expect(errorsOf({ ...VALID, pitch: 'curto' }).pitch).toBeDefined();
    expect(errorsOf({ ...VALID, pitch: 'x'.repeat(1001) }).pitch).toBeDefined();
    expect(errorsOf({ ...VALID, pitch: 'x'.repeat(20) }).pitch).toBeUndefined();
  });

  it('pelo menos uma rede, com a frase no Instagram', () => {
    expect(errorsOf({ ...VALID, instagram: '', tiktok: '' }).instagram).toBe(
      'Informe pelo menos o Instagram ou o TikTok.',
    );
    expect(errorsOf({ ...VALID, instagram: '', tiktok: '@camila' })).toEqual({});
  });

  it('a rede fora do formato fica no campo dela', () => {
    expect(errorsOf({ ...VALID, tiktok: 'https://instagram.com/camila' }).tiktok).toBe(
      'Confira o @ do TikTok.',
    );
  });

  it('o WhatsApp é obrigatório e segue a regra da loja (o celular com o DDD e o 9)', () => {
    expect(errorsOf({ ...VALID, whatsapp: '' }).whatsapp).toBe('Informe seu WhatsApp com o DDD.');
    expect(errorsOf({ ...VALID, whatsapp: '(75) 3123-4567' }).whatsapp).toBe(
      'Confira o número: o DDD e o celular, com o 9 na frente.',
    );
  });

  it('o artista, os 18 anos e o aceite das regras', () => {
    const errors = errorsOf({ ...VALID, artistId: '', adult: false, rules: false });
    expect(errors.artistId).toBe('Escolha o artista.');
    expect(errors.adult).toBe('Para ter um fã-clube, confirme que você tem 18 anos ou mais.');
    expect(errors.rules).toBe('Para enviar, aceite as regras.');
  });
});

describe('postSchema: a publicação', () => {
  it('de 1 a 1.000, limpa', () => {
    expect(postSchema.parse({ text: '  Que show!  ' })).toEqual({ text: 'Que show!' });
    expect(postSchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(postSchema.safeParse({ text: 'x'.repeat(1001) }).success).toBe(false);
    expect(postSchema.safeParse({ text: 'x'.repeat(1000) }).success).toBe(true);
  });
});

describe('format', () => {
  it('o fim do Destaque no dia de São Paulo, sem passar pelo fuso', () => {
    expect(formatDayKey('2026-10-25')).toBe('25/10/2026');
    expect(formatDayKey('25/10/2026')).toBe('');
  });

  it('a frase da próxima rodada', () => {
    expect(nextRoundText({ kind: 'now' })).toBe('Você já pode enviar uma nova candidatura.');
    expect(nextRoundText({ kind: 'date', date: '2026-11-17T15:00:00.000Z' })).toBe(
      'Você pode enviar de novo a partir de 17/11/2026.',
    );
    expect(nextRoundText({ kind: 'roundsOver' })).toBe('Você já usou as 3 candidaturas.');
    expect(nextRoundText({ kind: 'never' })).toBe('Você não pode mais ter um fã-clube.');
    expect(nextRoundText({ kind: 'programClosed' })).toBe(
      'As candidaturas para fã-clube estão fechadas agora.',
    );
  });
});
