/**
 * Nome de cada UF, para o leitor de tela dizer "Irará, Bahia" no lugar de
 * "Irará, B A". A tela mostra a sigla, como no protótipo. Nome de lugar é
 * dado, não texto da interface: não passa por `t()`.
 */
export const BRAZIL_STATE_NAMES: Readonly<Record<string, string>> = {
  AC: 'Acre',
  AL: 'Alagoas',
  AP: 'Amapá',
  AM: 'Amazonas',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais',
  PA: 'Pará',
  PB: 'Paraíba',
  PR: 'Paraná',
  PE: 'Pernambuco',
  PI: 'Piauí',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul',
  RO: 'Rondônia',
  RR: 'Roraima',
  SC: 'Santa Catarina',
  SP: 'São Paulo',
  SE: 'Sergipe',
  TO: 'Tocantins',
};

/**
 * Fonte do sistema a partir da qual a agenda deixa de cortar texto: a linha
 * põe o "Eu vou" embaixo do título, e os títulos quebram inteiros. É a maior
 * fonte do Android sem a ampliação de acessibilidade (1,3); daí para cima, o
 * "Confirmado" ao lado deixaria menos de uma palavra por linha para o título
 * num aparelho de 360.
 */
export const LARGE_TEXT_SCALE = 1.3;
