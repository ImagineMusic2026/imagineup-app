import { AccessibilityInfo } from 'react-native';

import { announceFirstError, firstErrorMessage, type FormErrors } from '../form-errors';

type Field = 'name' | 'email' | 'password';
const order: Field[] = ['name', 'email', 'password'];

describe('firstErrorMessage', () => {
  it.each<[string, FormErrors<Field>, string | null]>([
    ['sem erro', {}, null],
    ['só a senha', { password: { message: 'Senha curta.' } }, 'Senha curta.'],
    [
      'segue a ordem da tela, não a do objeto',
      { password: { message: 'Senha curta.' }, email: { message: 'E-mail inválido.' } },
      'E-mail inválido.',
    ],
    [
      'pula erro sem mensagem',
      { name: { message: '' }, email: { message: 'E-mail inválido.' } },
      'E-mail inválido.',
    ],
    ['mensagem que não é texto não conta', { name: { message: 42 } }, null],
  ])('%s', (_, errors, expected) => {
    expect(firstErrorMessage(errors, order)).toBe(expected);
  });
});

describe('announceFirstError', () => {
  beforeEach(() => jest.clearAllMocks());

  it('anuncia só o primeiro erro', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    announceFirstError<Field>(
      { email: { message: 'E-mail inválido.' }, password: { message: 'Senha curta.' } },
      order,
    );
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('E-mail inválido.');
  });

  it('sem erro, fica calado', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    announceFirstError<Field>({}, order);
    expect(announce).not.toHaveBeenCalled();
  });
});
