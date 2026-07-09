import type { schema } from '@opensales/db';

export interface SessionUser {
  id: string;
  email: string;
  role: 'admin' | 'operator';
}

export interface SessionContext {
  user: SessionUser;
  session: schema.Session;
}

declare module 'express' {
  interface Request {
    sessionContext?: SessionContext;
  }
}
