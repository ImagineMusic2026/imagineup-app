/** Garante no TypeScript que todo caso de uma união foi tratado. */
export function assertNever(value: never): never {
  throw new Error(`Caso não tratado: ${String(value)}`);
}
