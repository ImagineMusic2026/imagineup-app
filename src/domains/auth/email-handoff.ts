/**
 * E-mail que o cadastro passa para o entrar quando ele já tem conta ("Entrar
 * com este e-mail"). Fica só na memória, e não num parâmetro da rota, para o
 * e-mail não entrar no endereço da tela.
 */
let handedOff: string | null = null;

export function handOffEmail(email: string): void {
  handedOff = email;
}

/** Lê sem apagar: quem lê apaga depois de montar (`clearHandedOffEmail`). */
export function readHandedOffEmail(): string | null {
  return handedOff;
}

export function clearHandedOffEmail(): void {
  handedOff = null;
}
