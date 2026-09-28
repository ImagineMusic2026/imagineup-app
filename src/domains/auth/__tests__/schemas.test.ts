import { signInSchema } from '../schemas';

const parseEmail = (email: string) => signInSchema.safeParse({ email, password: '123456' });

describe('e-mail do login', () => {
  it.each(['fa@x.com ', ' Fa@X.com', 'fa@x.com\n', 'FA@X.COM'])(
    '"%s" passa e vira fa@x.com',
    (email) => {
      const result = parseEmail(email);
      expect(result.success).toBe(true);
      expect(result.data?.email).toBe('fa@x.com');
    },
  );

  it.each(['', 'nope', 'nope ', 'fa@', '@x.com'])('"%s" é recusado', (email) => {
    expect(parseEmail(email).success).toBe(false);
  });

  it('a mensagem de erro sai em pt-BR', () => {
    const result = parseEmail('nope');
    expect(result.error?.issues[0]?.message).toBe('Digite um e-mail válido.');
  });
});
