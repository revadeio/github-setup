#!/usr/bin/env node
'use strict';

const { setup } = require('./lib.js');

function usage() {
  return [
    'Usage: GH_TOKEN=<token> github-setup <repo_url> [repo_url...]',
    '',
    '  <repo_url>  one or more GitHub repos, each as a URL',
    '              (https://github.com/owner/repo), an SSH remote',
    '              (git@github.com:owner/repo.git), or a plain',
    '              "owner/repo" slug. Repos are set up independently —',
    '              one failing does not stop the rest.',
    '',
    'Requires a GH_TOKEN with admin rights on each repo (repo scope, or a',
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
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '-h' || args[0] === '--help') {
    console.log(usage());
    process.exit(args.length ? 0 : 1);
  }

  const token = process.env.GH_TOKEN;
  if (!token) {
    console.error('error: GH_TOKEN environment variable is required\n');
    console.error(usage());
    process.exit(1);
  }

  const failures = [];
  for (const arg of args) {
    try {
      await setup(arg, token, fetch, (line) => console.log(line));
      console.log(`done: ${arg}`);
    } catch (err) {
      console.error(`error: ${arg}: ${err.message}`);
      failures.push(arg);
    }
    if (args.length > 1) console.log('');
  }

  if (args.length > 1) {
    console.log(`${args.length - failures.length}/${args.length} repos configured successfully.`);
  }
  if (failures.length) process.exit(1);
}

main();
