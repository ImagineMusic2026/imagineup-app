import {
  clearHandedOffEmail,
  handOffEmail,
  readEmailHandoffReason,
  readHandedOffEmail,
} from '../email-handoff';

const EMAIL = 'camila@x.com';

// O e-mail fica na memória do módulo: cada teste começa sem nada guardado.
afterEach(() => clearHandedOffEmail());

describe('e-mail que o cadastro passa para o entrar', () => {
  it('sem nada guardado, não há e-mail nem motivo', () => {
    expect(readHandedOffEmail()).toBeNull();
    expect(readEmailHandoffReason()).toBeNull();
  });

  it('sem dizer o motivo, o e-mail vai só para o fã não digitar de novo', () => {
    handOffEmail(EMAIL);
    expect(readHandedOffEmail()).toBe(EMAIL);
    expect(readEmailHandoffReason()).toBe('prefill');
  });

  it('o cadastro que descobriu que o e-mail já tem conta diz o motivo', () => {
    handOffEmail(EMAIL, 'emailInUse');
    expect(readHandedOffEmail()).toBe(EMAIL);
    expect(readEmailHandoffReason()).toBe('emailInUse');
  });

  it('ler não apaga: quem lê apaga depois de montar', () => {
    handOffEmail(EMAIL, 'emailInUse');
    readHandedOffEmail();
    readEmailHandoffReason();
    expect(readHandedOffEmail()).toBe(EMAIL);
    expect(readEmailHandoffReason()).toBe('emailInUse');
  });

  it('limpar apaga o e-mail e o motivo juntos', () => {
    handOffEmail(EMAIL, 'emailInUse');
    clearHandedOffEmail();
    expect(readHandedOffEmail()).toBeNull();
    expect(readEmailHandoffReason()).toBeNull();
  });

  it('um e-mail novo troca o anterior, com o motivo dele', () => {
    handOffEmail(EMAIL, 'emailInUse');
    handOffEmail('bia@x.com');
    expect(readHandedOffEmail()).toBe('bia@x.com');
    expect(readEmailHandoffReason()).toBe('prefill');
  });
});
