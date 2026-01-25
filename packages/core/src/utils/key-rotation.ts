import { rotateEncryptionKey } from './encryption';

export async function rotateAllBotTokens(oldKey: string, newKey: string): Promise<void> {
  await rotateEncryptionKey(oldKey, newKey);
}
