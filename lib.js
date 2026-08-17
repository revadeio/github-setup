'use strict';

const API_ROOT = 'https://api.github.com';
const RULESET_NAME = 'default-branch-protection';

function parseRepoUrl(input) {
  const trimmed = input.trim();

  let m = /^git@github\.com:([^/]+)\/(.+?)(\.git)?$/.exec(trimmed);
  if (m) return { owner: m[1], repo: m[2] };

  m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(\.git)?\/?$/.exec(trimmed);
  if (m) return { owner: m[1], repo: m[2] };

  m = /^([^/\s]+)\/([^/\s]+?)(\.git)?$/.exec(trimmed);
  if (m) return { owner: m[1], repo: m[2] };

  throw new Error(`could not parse a GitHub owner/repo from "${input}"`);
}

function restHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function rest(method, path, token, body, fetchImpl = fetch) {
  const res = await fetchImpl(`${API_ROOT}${path}`, {
    method,
    headers: restHeaders(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = (data && data.message) || res.statusText;
    throw new Error(`${method} ${path} -> ${res.status} ${msg}`);
  }
  return data;
}

async function graphql(token, query, variables, fetchImpl = fetch) {
  const res = await fetchImpl(`${API_ROOT}/graphql`, {
    method: 'POST',
    headers: restHeaders(token),
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) {
    const msg = data.errors ? data.errors.map((e) => e.message).join('; ') : res.statusText;
    throw new Error(`graphql -> ${res.status} ${msg}`);
  }
  return data.data;
}

async function getRepo(owner, repo, token, fetchImpl) {
  return rest('GET', `/repos/${owner}/${repo}`, token, undefined, fetchImpl);
}

async function updateRepoSettings(owner, repo, token, fetchImpl) {
  return rest('PATCH', `/repos/${owner}/${repo}`, token, {
    has_wiki: true,
    has_issues: true,
    has_projects: false,
    has_pull_requests: true,
    allow_merge_commit: false,
    allow_squash_merge: true,
    squash_merge_commit_title: 'PR_TITLE',
    squash_merge_commit_message: 'PR_BODY',
    allow_rebase_merge: true,
    delete_branch_on_merge: true,
  }, fetchImpl);
}

// REST's PATCH /repos/{owner}/{repo} has no field for Discussions; the
// GraphQL updateRepository mutation is the only API that exposes it
// (confirmed via live schema introspection, cycle 16).
async function enableDiscussions(nodeId, token, fetchImpl) {
  const query = `
    mutation($repositoryId: ID!) {
      updateRepository(input: { repositoryId: $repositoryId, hasDiscussionsEnabled: true }) {
        repository { hasDiscussionsEnabled }
      }
    }
  `;
  const data = await graphql(token, query, { repositoryId: nodeId }, fetchImpl);
  return data.updateRepository.repository;
}

function branchRulesetBody() {
  return {
    name: RULESET_NAME,
    target: 'branch',
    enforcement: 'active',
    conditions: {
      ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] },
    },
    // actor_id 5 is RepositoryRole's well-known ID for "Admin" (confirmed
    // live: ids 1/3, lacking write permission, are rejected by GitHub's own
    // validation; 2/4/5 are accepted and correspond to maintain/write/admin
    // per github/rest-api-description#4406 and the GitHub Terraform
    // provider's documented role mapping) — repo admins can still push
    // directly instead of being blocked by their own ruleset.
    bypass_actors: [
      { actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'always' },
    ],
    rules: [
      { type: 'deletion' },
      { type: 'required_linear_history' },
      { type: 'non_fast_forward' },
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: 1,
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: true,
          required_review_thread_resolution: true,
          allowed_merge_methods: ['squash'],
        },
      },
    ],
  };
}

async function findRuleset(owner, repo, token, fetchImpl) {
  const rulesets = await rest('GET', `/repos/${owner}/${repo}/rulesets`, token, undefined, fetchImpl);
  return rulesets.find((r) => r.name === RULESET_NAME) || null;
}

async function applyBranchRuleset(owner, repo, token, fetchImpl) {
  const existing = await findRuleset(owner, repo, token, fetchImpl);
  const body = branchRulesetBody();
  if (existing) {
    return rest('PUT', `/repos/${owner}/${repo}/rulesets/${existing.id}`, token, body, fetchImpl);
  }
  return rest('POST', `/repos/${owner}/${repo}/rulesets`, token, body, fetchImpl);
}

async function setup(repoUrlOrSlug, token, fetchImpl = fetch, log = () => {}) {
  const { owner, repo } = parseRepoUrl(repoUrlOrSlug);
  log(`repo: ${owner}/${repo}`);

  const info = await getRepo(owner, repo, token, fetchImpl);
  log(`found repo (default branch: ${info.default_branch})`);

  await updateRepoSettings(owner, repo, token, fetchImpl);
  log('features + merge settings applied (wiki/issues on, projects off, PRs on, ' +
    'squash+rebase merge only with PR title/description, auto-delete head branches)');

  const discussions = await enableDiscussions(info.node_id, token, fetchImpl);
  log(`discussions enabled: ${discussions.hasDiscussionsEnabled}`);

  await applyBranchRuleset(owner, repo, token, fetchImpl);
  log('default-branch ruleset applied (restrict deletions, require linear history, block force ' +
    'pushes, require a PR with 1 approval + last-push approval + resolved conversations + squash-only ' +
    'merge, repo admins can bypass)');

  return { owner, repo };
}

module.exports = {
  parseRepoUrl,
  restHeaders,
  rest,
  graphql,
  getRepo,
  updateRepoSettings,
  enableDiscussions,
  branchRulesetBody,
  findRuleset,
  applyBranchRuleset,
  setup,
  RULESET_NAME,
};
