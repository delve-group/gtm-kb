import type { AuthInfo } from '@modelcontextprotocol/server';
import {
  AuthError,
  freezeActorContext,
  parseBearerAuthorization,
  type ActorContext,
  type AuthenticatedPrincipal,
} from '../auth/index.js';

export function principalToMcpAuthInfo(
  authorization: string,
  principal: AuthenticatedPrincipal,
): AuthInfo {
  const token = parseBearerAuthorization(authorization);
  if (!token) throw new AuthError('UNAUTHENTICATED', 'Valid authentication is required.', 401);
  return {
    token,
    clientId:
      principal.actor.authMethod === 'github'
        ? `github:${String(principal.actor.githubUserId ?? 'unknown')}`
        : 'shared-secret',
    scopes: principal.actor.canWrite ? ['brain:read', 'brain:propose'] : ['brain:read'],
    extra: {
      actor: principal.actor,
      ...(principal.sessionId === undefined ? {} : { sessionId: principal.sessionId }),
    },
  };
}

export function actorFromAuthInfo(authInfo: AuthInfo | undefined): ActorContext {
  const actor = authInfo?.extra?.actor;
  if (!actor || typeof actor !== 'object') {
    throw new AuthError('UNAUTHENTICATED', 'Valid authentication is required.', 401);
  }
  return freezeActorContext(actor as ActorContext);
}
