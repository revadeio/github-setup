'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRepoUrl,
  branchRulesetBody,
  clarifyRulesetError,
  applyBranchRuleset,
  setup,
  RULESET_NAME,
} = require('./lib.js');

test('parseRepoUrl: https URL', () => {
  assert.deepEqual(parseRepoUrl('https://github.com/angarg/paperloom'), {
    owner: 'angarg',
    repo: 'paperloom',
  });
});

test('parseRepoUrl: https URL with .git suffix and trailing slash', () => {
  assert.deepEqual(parseRepoUrl('https://github.com/angarg/paperloom.git/'), {
    owner: 'angarg',
    repo: 'paperloom',
  });
});

test('parseRepoUrl: ssh remote', () => {
  assert.deepEqual(parseRepoUrl('git@github.com:angarg/paperloom.git'), {
    owner: 'angarg',
    repo: 'paperloom',
  });
});

test('parseRepoUrl: bare owner/repo slug', () => {
  assert.deepEqual(parseRepoUrl('angarg/paperloom'), {
    owner: 'angarg',
    repo: 'paperloom',
  });
});

test('parseRepoUrl: rejects garbage input', () => {
  assert.throws(() => parseRepoUrl('not a repo at all'));
});

test('branchRulesetBody: targets default branch with the four required rules', () => {
  const body = branchRulesetBody();
  assert.equal(body.name, RULESET_NAME);
  assert.equal(body.target, 'branch');
  assert.equal(body.enforcement, 'active');
  assert.deepEqual(body.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  const types = body.rules.map((r) => r.type).sort();
  assert.deepEqual(types, ['deletion', 'non_fast_forward', 'pull_request', 'required_linear_history']);
});

test('branchRulesetBody: repo admins bypass via the well-known RepositoryRole id', () => {
  const body = branchRulesetBody();
  assert.deepEqual(body.bypass_actors, [
    { actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'always' },
  ]);
});

test('branchRulesetBody: pull_request rule matches the required review settings', () => {
  const body = branchRulesetBody();
  const pr = body.rules.find((r) => r.type === 'pull_request');
  assert.deepEqual(pr.parameters, {
    required_approving_review_count: 1,
    dismiss_stale_reviews_on_push: true,
    require_code_owner_review: false,
    require_last_push_approval: true,
    required_review_thread_resolution: true,
    allowed_merge_methods: ['squash'],
  });
});

// Fake fetch that records every call and returns canned responses keyed by
// method+path, so setup()'s full orchestration can be exercised without
// hitting the real GitHub API.
function makeFakeFetch({ rulesetsExisting = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const path = url.replace('https://api.github.com', '');
    const method = opts.method || 'GET';
    calls.push({ method, path, body: opts.body ? JSON.parse(opts.body) : null });

    const json = (status, body) => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'status',
      text: async () => JSON.stringify(body),
      json: async () => body,
    });

    if (method === 'GET' && path === '/repos/angarg/paperloom') {
      return json(200, { node_id: 'R_kgNODEID', default_branch: 'main', owner: { type: 'User' } });
    }
    if (method === 'PATCH' && path === '/repos/angarg/paperloom') {
      return json(200, { updated: true });
    }
    if (path === '/graphql') {
      return json(200, {
        data: {
          updateRepository: { repository: { hasDiscussionsEnabled: true } },
        },
      });
    }
    if (method === 'GET' && path === '/repos/angarg/paperloom/rulesets') {
      return json(200, rulesetsExisting);
    }
    if (method === 'POST' && path === '/repos/angarg/paperloom/rulesets') {
      return json(201, { id: 1, name: RULESET_NAME });
    }
    if (method === 'PUT' && path.startsWith('/repos/angarg/paperloom/rulesets/')) {
      return json(200, { id: 1, name: RULESET_NAME });
    }
    throw new Error(`unexpected call: ${method} ${path}`);
  };
  return { fetchImpl, calls };
}

test('setup: full orchestration, no existing ruleset -> creates one', async () => {
  const { fetchImpl, calls } = makeFakeFetch({ rulesetsExisting: [] });
  const result = await setup('https://github.com/angarg/paperloom', 'fake-token', fetchImpl);

  assert.deepEqual(result, { owner: 'angarg', repo: 'paperloom' });

  const methods = calls.map((c) => `${c.method} ${c.path}`);
  assert.ok(methods.includes('GET /repos/angarg/paperloom'));
  assert.ok(methods.includes('PATCH /repos/angarg/paperloom'));
  assert.ok(methods.includes('POST /graphql'));
  assert.ok(methods.includes('GET /repos/angarg/paperloom/rulesets'));
  assert.ok(methods.includes('POST /repos/angarg/paperloom/rulesets'));
  assert.ok(!methods.some((m) => m.startsWith('PUT ')));

  const patchCall = calls.find((c) => c.method === 'PATCH');
  assert.equal(patchCall.body.has_projects, false);
  assert.equal(patchCall.body.allow_merge_commit, false);
  assert.equal(patchCall.body.allow_squash_merge, true);
  assert.equal(patchCall.body.squash_merge_commit_title, 'PR_TITLE');
  assert.equal(patchCall.body.squash_merge_commit_message, 'PR_BODY');
  assert.equal(patchCall.body.allow_rebase_merge, true);
  assert.equal(patchCall.body.delete_branch_on_merge, true);
  assert.equal(patchCall.body.has_discussions, undefined, 'discussions must go through GraphQL, not REST');

  const gqlCall = calls.find((c) => c.path === '/graphql');
  assert.match(gqlCall.body.query, /hasDiscussionsEnabled: true/);
  assert.equal(gqlCall.body.variables.repositoryId, 'R_kgNODEID');
});

test('setup: existing ruleset with the same name -> updates in place (idempotent)', async () => {
  const { fetchImpl, calls } = makeFakeFetch({
    rulesetsExisting: [{ id: 42, name: RULESET_NAME }],
  });
  await setup('angarg/paperloom', 'fake-token', fetchImpl);

  const methods = calls.map((c) => `${c.method} ${c.path}`);
  assert.ok(methods.includes('PUT /repos/angarg/paperloom/rulesets/42'));
  assert.ok(!methods.some((m) => m.startsWith('POST /repos/')));
});

test('clarifyRulesetError: leaves non-plan errors untouched', () => {
  const err = new Error('GET /repos/x/y/rulesets -> 404 Not Found');
  assert.equal(clarifyRulesetError(err, 'Organization', 'revadeio'), err);
});

test('clarifyRulesetError: leaves the plan-gate error untouched for a personal-account owner', () => {
  const err = new Error(
    'POST /repos/x/y/rulesets -> 403 Upgrade to GitHub Pro or make this repository public to enable this feature.'
  );
  assert.equal(clarifyRulesetError(err, 'User', 'someuser'), err);
});

test('clarifyRulesetError: adds the org-plan clarification when owner is an Organization', () => {
  const err = new Error(
    'POST /repos/revadeio/paperloom/rulesets -> 403 Upgrade to GitHub Pro or make this repository public to enable this feature.'
  );
  const clarified = clarifyRulesetError(err, 'Organization', 'revadeio');
  assert.notEqual(clarified, err);
  assert.match(clarified.message, /organization/i);
  assert.match(clarified.message, /Team or Enterprise/);
  assert.match(clarified.message, /"revadeio"/);
});

test('applyBranchRuleset: a 403 plan-gate error from an org repo is clarified end-to-end', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    statusText: 'Forbidden',
    text: async () => JSON.stringify({
      message: 'Upgrade to GitHub Pro or make this repository public to enable this feature.',
    }),
  });
  await assert.rejects(
    () => applyBranchRuleset('revadeio', 'paperloom', 'fake-token', 'Organization', fetchImpl),
    /"revadeio" is an organization/i,
  );
});

test('setup: REST error surfaces repo/path/status in the message', async () => {
  const fetchImpl = async (url) => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    text: async () => JSON.stringify({ message: 'Not Found' }),
  });
  await assert.rejects(
    () => setup('angarg/does-not-exist', 'fake-token', fetchImpl),
    /404/,
  );
});
