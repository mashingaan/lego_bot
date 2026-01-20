// Простой тестовый endpoint для проверки работы serverless functions
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('✅ Test endpoint called');
  return res.status(200).json({ 
    ok: true, 
    message: 'Test endpoint works',
    timestamp: new Date().toISOString()
  });
}

