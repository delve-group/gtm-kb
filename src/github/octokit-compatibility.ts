import type { Octokit } from '@octokit/rest';

import type { GitHubClient } from './types.js';

type AssertGitHubClient<T extends GitHubClient> = T;

// This fails compilation if the narrow mock-friendly interface drifts away from Octokit.
export type OctokitCompatibleClient = AssertGitHubClient<Octokit>;
