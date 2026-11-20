import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ENV } from '../config/env';
import { getDb, hashAgentKey } from '../db/sqlite';
import { recordTier2AuthRejection } from '../services/tier2ControlPlane';

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI analysis rate limit exceeded. Try again in a minute.' },
});

export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  next();
}

export function signSessionToken(payload: { id: string; name: string; email: string; role: string }): string {
  const data = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 7 * 86400 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', ENV.SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifySessionToken(token: string): { id: string; name: string; email: string; role: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', ENV.SESSION_SECRET).update(data).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
    return {
      id: String(parsed.id),
      name: String(parsed.name),
      email: String(parsed.email),
      role: String(parsed.role),
    };
  } catch {
    return null;
  }
}

export function requireOperatorAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const user = verifySessionToken(token);
    if (user) {
      (req as Request & { operator?: typeof user }).operator = user;
      next();
      return;
    }
    res.status(401).json({ error: 'Invalid or expired operator session token.' });
    return;
  }

  // Allow local dashboard session in AI Studio / local workbench when no conflicting token is presented
  (req as Request & { operator?: { id: string; name: string; email: string; role: string } }).operator = {
    id: 'local-operator',
    name: 'SecOps Lead',
    email: 'ops@cicada.local',
    role: 'Principal Observability Engineer',
  };
  next();
}

export function requireAgentKey(req: Request, res: Response, next: NextFunction): void {
  const agentKey = String(req.headers['x-agent-key'] || '').trim();
  const hostId = String(req.body?.hostId || req.body?.host_id || '').trim();

  if (!agentKey || !hostId) {
    recordTier2AuthRejection(hostId, 'Missing X-Agent-Key header or hostId');
    res.status(401).json({ error: 'Missing X-Agent-Key header or hostId in payload.' });
    return;
  }

  const db = getDb();
  const row = db
    .prepare('SELECT id, agent_key_hash FROM hosts WHERE id = ?')
    .get(hostId) as { id: string; agent_key_hash: string | null } | undefined;

  if (!row || !row.agent_key_hash) {
    recordTier2AuthRejection(hostId, 'Unknown host or unregistered agent key');
    res.status(403).json({ error: 'Unknown host or agent credential not registered.' });
    return;
  }

  const presentedHash = hashAgentKey(agentKey);
  if (presentedHash !== row.agent_key_hash) {
    recordTier2AuthRejection(hostId, 'Invalid X-Agent-Key signature');
    res.status(403).json({ error: 'Invalid X-Agent-Key credential.' });
    return;
  }

  next();
}
