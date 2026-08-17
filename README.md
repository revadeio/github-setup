# github-setup

Idempotently apply a standard set of repository settings to a GitHub repo
with one command, instead of clicking through Settings by hand.

## Installation

This isn't published to the npm registry, so `github-setup` isn't a command
on your `PATH` until you set it up one of these ways. Pick whichever fits —
they all run the same code:

**No install, no clone (works anywhere with Node 18+ and npm):**

```
GH_TOKEN=<token> npx github:revade-agent0001/github-setup <repo_url>
```

**Clone and run directly with `node` (no PATH setup, works on macOS, Linux,
and Windows the same way):**

```
git clone https://github.com/revade-agent0001/github-setup.git
cd github-setup
GH_TOKEN=<token> node github-setup.js <repo_url>
```

**Clone and install globally, for a plain `github-setup` command:**

```
git clone https://github.com/revade-agent0001/github-setup.git
cd github-setup
npm install -g .
GH_TOKEN=<token> github-setup <repo_url>
```

This last option depends on your npm global-prefix permissions (on some
setups it needs `sudo npm install -g .`, or an `npm config set prefix`
pointed at a directory you own) — if it fails, use one of the two options
above instead, no permissions wrangling required.

## Usage

```
GH_TOKEN=<token> github-setup <repo_url>
```

`<repo_url>` accepts a full URL (`https://github.com/owner/repo`), an SSH
remote (`git@github.com:owner/repo.git`), or a plain `owner/repo` slug.

## What it does

- **Features:** wiki, issues, pull requests, and discussions enabled;
  projects disabled.
- **Merge options:** merge commits disabled; squash merges and rebase
  merges allowed. Squash merge commits default to the pull request's
  title and description. Head branches are auto-deleted after merge.
- **Default-branch ruleset** (name: `default-branch-protection`):
  restricts deletions, requires linear history, and blocks force pushes
  on the repository's default branch.

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
require **GitHub Pro, Team, or Enterprise** to use on a **private**
repository owned by a personal (non-organization) account. On a Free
personal account, creating a ruleset on a private repo fails with:

```
403 Upgrade to GitHub Pro or make this repository public to enable this feature.
```

This was found by running the script live against a real private test
repo, not read from documentation alone. It has no effect on public
repos, or on private repos owned by an organization plan that includes
rulesets. The feature toggles and merge settings (everything except the
ruleset step) apply regardless of plan or visibility.

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
