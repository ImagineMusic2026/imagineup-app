// O erro de campo da gravação estrita da configuração (régua, temporada,
// missões e conquistas). Fica num módulo sozinho para os modelos puros das
// missões e das conquistas usarem sem importar o points/config.ts, que importa
// o núcleo de pontos, que importa os dois: o ciclo em tempo de execução.

/** Campo errado na gravação estrita, com o caminho dele (`values.like`, `mission.goal`). */
export class ConfigValidationError extends Error {
  readonly field: string;

  constructor(field: string) {
    super(`Configuração inválida em ${field}.`);
    this.name = 'ConfigValidationError';
    this.field = field;
  }
}
