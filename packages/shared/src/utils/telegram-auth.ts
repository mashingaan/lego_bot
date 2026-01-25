import crypto from 'crypto';

export function validateTelegramWebAppData(
  initData: string,
  botToken: string
): { valid: boolean; userId?: number } {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) {
      return { valid: false };
    }

    params.delete('hash');

    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) {
      return { valid: false };
    }

    const userRaw = params.get('user');
    if (!userRaw) {
      return { valid: false };
    }

    const user = JSON.parse(userRaw) as { id?: number };
    if (!user?.id || typeof user.id !== 'number') {
      return { valid: false };
    }

    return { valid: true, userId: user.id };
  } catch {
    return { valid: false };
  }
}
