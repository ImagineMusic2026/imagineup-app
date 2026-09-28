import { storage, StorageKeys } from '@/services/storage';

export interface PendingInvite {
  code: string;
  receivedAt: string;
}

/**
 * O código do convite fica guardado até o cadastro terminar, porque a pessoa
 * convidada ainda vai passar pelo login. Quem manda o código para a API (e
 * credita os pontos de quem convidou) é o fluxo de cadastro.
 */
export async function savePendingInvite(code: string): Promise<void> {
  const current = await storage.getJSON<PendingInvite>(StorageKeys.PendingInvite);
  // O primeiro convite vale: um segundo link não troca quem trouxe a pessoa.
  if (current) return;
  await storage.setJSON<PendingInvite>(StorageKeys.PendingInvite, {
    code,
    receivedAt: new Date().toISOString(),
  });
}

export function readPendingInvite(): Promise<PendingInvite | null> {
  return storage.getJSON<PendingInvite>(StorageKeys.PendingInvite);
}

export function clearPendingInvite(): Promise<void> {
  return storage.remove(StorageKeys.PendingInvite);
}
