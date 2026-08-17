#!/usr/bin/env node
'use strict';

const { setup } = require('./lib.js');

function usage() {
  return [
    'Usage: GH_TOKEN=<token> github-setup <repo_url>',
    '',
    '  <repo_url>  a GitHub repo as a URL (https://github.com/owner/repo),',
    '              an SSH remote (git@github.com:owner/repo.git), or a',
    '              plain "owner/repo" slug.',
    '',
    'Requires a GH_TOKEN with admin rights on the repo (repo scope, or a',
    'fine-grained token with Administration: read & write). Configures:',
    '  - wiki, issues, pull requests, discussions: enabled',
    '  - projects: disabled',
    '  - merge commits: disabled; squash and rebase merges: allowed',
    '  - squash merge commit uses the PR title + description',
    '  - head branches auto-deleted after merge',
    '  - a ruleset on the default branch: restrict deletions, require',
    '    linear history, block force pushes',
    'Safe to re-run: repo settings are idempotent PATCHes, and the',
    'ruleset is created once and updated in place on subsequent runs.',
  ].join('\n');
}

async function main() {
  const arg = process.argv[2];
  if (!arg || arg === '-h' || arg === '--help') {
    console.log(usage());
    process.exit(arg ? 0 : 1);
  }

  const token = process.env.GH_TOKEN;
  if (!token) {
    console.error('error: GH_TOKEN environment variable is required\n');
    console.error(usage());
    process.exit(1);
  }

  try {
    await setup(arg, token, fetch, (line) => console.log(line));
    console.log('done.');
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}

main();
