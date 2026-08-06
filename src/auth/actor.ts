export type AuthMethod = 'secret' | 'github';

export type RepositoryPermission = 'none' | 'read' | 'triage' | 'write' | 'maintain' | 'admin';

export interface ActorContext {
  readonly authMethod: AuthMethod;
  readonly githubUserId?: number;
  readonly githubLogin?: string;
  readonly repository: string;
  readonly repositoryPermission: RepositoryPermission;
  readonly canRead: boolean;
  readonly canWrite: boolean;
}

const permissionRank: Readonly<Record<RepositoryPermission, number>> = Object.freeze({
  none: 0,
  read: 1,
  triage: 2,
  write: 3,
  maintain: 4,
  admin: 5,
});

export function hasRepositoryPermission(
  actual: RepositoryPermission,
  required: RepositoryPermission,
): boolean {
  return permissionRank[actual] >= permissionRank[required];
}

export function createSecretActor(input: {
  repository: string;
  allowWrites?: boolean;
}): ActorContext {
  return Object.freeze({
    authMethod: 'secret',
    repository: input.repository,
    repositoryPermission: input.allowWrites ? 'write' : 'read',
    canRead: true,
    canWrite: input.allowWrites === true,
  });
}

export function createGitHubActor(input: {
  githubUserId: number;
  githubLogin: string;
  repository: string;
  repositoryPermission: RepositoryPermission;
  appCanRead: boolean;
  appCanWrite: boolean;
}): ActorContext {
  const canRead = input.appCanRead && hasRepositoryPermission(input.repositoryPermission, 'read');
  const canWrite =
    canRead && input.appCanWrite && hasRepositoryPermission(input.repositoryPermission, 'write');

  return Object.freeze({
    authMethod: 'github',
    githubUserId: input.githubUserId,
    githubLogin: input.githubLogin,
    repository: input.repository,
    repositoryPermission: input.repositoryPermission,
    canRead,
    canWrite,
  });
}

export function freezeActorContext(actor: ActorContext): ActorContext {
  return Object.freeze({ ...actor });
}
