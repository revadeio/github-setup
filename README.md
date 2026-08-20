# github-setup

Idempotently apply a standard set of repository settings to a GitHub repo
with one command, instead of clicking through Settings by hand.

## Installation

This isn't published to the npm registry, so `github-setup` isn't a command
on your `PATH` until you set it up one of these ways. Pick whichever fits —
they all run the same code:

**One-liner, for a plain `github-setup` command (installs under
`$HOME/.local`, no sudo, no system npm-prefix permission issues):**

```
curl -fsSL https://raw.githubusercontent.com/revadeio/github-setup/master/install | sh
GH_TOKEN=<token> github-setup <repo_url>
```

**No install, no clone (works anywhere with Node 18+ and npm):**

```
GH_TOKEN=<token> npx github:revadeio/github-setup <repo_url>
```

**Clone and run directly with `node` (no PATH setup, works on macOS, Linux,
and Windows the same way):**

```
git clone https://github.com/revadeio/github-setup.git
cd github-setup
GH_TOKEN=<token> node github-setup.js <repo_url>
```

## Usage

```
GH_TOKEN=<token> github-setup <repo_url> [repo_url...]
```

`<repo_url>` accepts a full URL (`https://github.com/owner/repo`), an SSH
remote (`git@github.com:owner/repo.git`), or a plain `owner/repo` slug. Pass
several to set up multiple repos in one run — each is configured
independently, so one failing doesn't stop the rest; the exit code is
non-zero if any repo failed, and a summary line (`N/M repos configured
successfully`) is printed when more than one repo was given.

## What it does

- **Features:** wiki, issues, pull requests, and discussions enabled;
  projects disabled.
- **Merge options:** merge commits disabled; squash merges and rebase
  merges allowed. Squash merge commits default to the pull request's
  title and description. Head branches are auto-deleted after merge.
- **Default-branch ruleset** (name: `default-branch-protection`):
  restricts deletions, requires linear history, blocks force pushes, and
  requires a pull request before merging (1 approval, dismiss stale
  approvals on push, require approval of the most recent push, require
  conversation resolution, squash-only) on the repository's default
  branch. Repository admins can bypass the ruleset (`RepositoryRole` id
  `5` — GitHub's undocumented-but-well-known ID for the built-in Admin
  role, confirmed by live-testing which `actor_id` values GitHub's own
  validation accepts, cross-referenced against
  [github/rest-api-description#4406](https://github.com/github/rest-api-description/issues/4406)).

Re-running against the same repo is safe: the repo-settings call is a
plain idempotent `PATCH`, and the ruleset step looks for an existing
ruleset named `default-branch-protection` and updates it in place
instead of creating a duplicate.

## Requirements

- Node.js 18+ (uses the built-in `fetch`; no dependencies).
- A `GH_TOKEN` with admin rights on the target repo (classic `repo`
  scope, or a fine-grained token with `Administration: read & write`,
  `Contents: read & write`, `Discussions: read & write`, and
  `Pull requests: read & write`).

## A real platform limitation, not a bug in this script

GitHub's [repository rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
require a paid plan to use on a **private** repository. Creating a ruleset
on a private repo without the right plan fails with:

```
403 Upgrade to GitHub Pro or make this repository public to enable this feature.
```

**The plan that matters depends on who owns the repo, and GitHub's own error
message doesn't say so** — this genuinely confused a real user (an org
owner with a personal Pro subscription, whose org-owned repo still hit this
403) before it was tracked down:

- **Personal-account-owned repo:** the *account's* plan must be Pro, Team,
  or Enterprise.
- **Organization-owned repo:** the *organization's* plan must be Team or
  Enterprise — an individual member's personal Pro subscription does not
  unlock this for repos owned by the org, even if that member is the org's
  owner/admin.

`github-setup` now detects this specific error and, when the repo is
org-owned, rewrites it to name the organization explicitly and say plainly
that the org's plan (not the caller's personal plan) is what needs to
change — instead of relaying GitHub's ambiguous message as-is.

The underlying 403 and its exact wording were found by running the script
live against a real private test repo on a personal Free-plan account. The
org-ownership branch of the clarification (the part that names the org
explicitly) is verified against that same real error string via an offline
test, not reproduced live against an actual org — doing that would need
admin rights on an organization already sitting on the Free plan, which
this script's own author doesn't have on the one org-owned repo this fix
was written for (only push/write access there, not admin — this script has
to be run by someone with admin rights on the target repo, i.e. an org
owner). It has no effect on public repos. The feature toggles and merge
settings (everything except the ruleset step) apply regardless of plan,
visibility, or ownership.

## Why discussions goes through GraphQL

The REST `PATCH /repos/{owner}/{repo}` endpoint has no field for
Discussions — confirmed against GitHub's published OpenAPI schema, not
assumed. The `updateRepository` GraphQL mutation's `hasDiscussionsEnabled`
field is the only API that exposes this toggle, so this script uses
GraphQL for that one setting and REST for everything else.

## Development

```
npm test
```

The test suite is fully offline (a fake `fetch` records and answers
calls) and also exercises the idempotent-update path against a
simulated pre-existing ruleset.
