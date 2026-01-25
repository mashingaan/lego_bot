import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;

/**
 * Шифрование токена AES-256
 */
export function encryptToken(token: string, encryptionKey: string): string {
  if (!encryptionKey || encryptionKey.length < 32) {
    throw new Error('Encryption key must be at least 32 characters long');
  }

  // Создаем ключ из encryptionKey
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = crypto.scryptSync(encryptionKey, salt, 32);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const tag = cipher.getAuthTag();
  
  // Формат: salt:iv:tag:encrypted
  return salt.toString('hex') + ':' + iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
}

/**
 * Расшифровка токена AES-256
 */
export function decryptToken(encryptedToken: string, encryptionKey: string): string {
  if (!encryptionKey || encryptionKey.length < 32) {
    throw new Error('Encryption key must be at least 32 characters long');
  }

  try {
    const parts = encryptedToken.split(':');
    if (parts.length !== 3 && parts.length !== 4) {
      throw new Error('Invalid encrypted token format');
    }

    const [maybeSaltHex, ivHex, tagHex, encrypted] = parts.length === 4
      ? parts
      : ['salt', ...parts];
    const salt = parts.length === 4 ? Buffer.from(maybeSaltHex, 'hex') : 'salt';
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    
    const key = crypto.scryptSync(encryptionKey, salt, 32);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    throw new Error(`Failed to decrypt token: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

