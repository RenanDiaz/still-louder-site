#!/usr/bin/env node
// Gated release of the ticket-system Worker. Run AFTER `npm run build`
// (`npm run release:cloudflare` does both).
//
//   1. Upload a new version with 0% traffic (`wrangler versions upload`).
//   2. Refuse to promote it if it lacks a required secret, or any secret the
//      live deployment has. Every version copies its secrets from the LATEST
//      UPLOADED version, so one secret-less upload (a branch preview build)
//      silently empties every later one — see docs/deploy-cloudflare.md,
//      "Releases seguros".
//   3. Smoke-test the version's Preview URL (`/api/presale/status`).
//   4. Promote it to 100%, smoke-test production and, if that fails, put the
//      previous deployment back.
//
// Flags:
//   --no-promote          stop after step 3 (prints the promote command)
//   --secrets-file <f>    pass-through to `versions upload` to rebuild the
//                         secret chain (gitignored secrets*.json, delete after)
//   --message <text>      version/deployment message (default: git HEAD)
//
// When it fails before promoting, production is untouched. The rejected
// version is still the latest upload, though, so the next one inherits its
// (missing) secrets: recover with --secrets-file.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unstable_readConfig } from 'wrangler';

// Secrets without which the API answers 500 or a core job breaks
// (api/_lib/env.ts `required()`, plus CRON_SECRET for the Worker's cron).
const REQUIRED_SECRETS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'RESEND_API_KEY',
  'TICKET_HMAC_SECRET',
  'ADMIN_PASSWORD',
  'STAFF_PASSWORD',
  'YAPPY_BTN_SECRET_KEY',
  'CRON_SECRET'
];
const SMOKE_PATH = '/api/presale/status';
const SMOKE_ATTEMPTS = 5;
const SMOKE_DELAY_MS = 4000;

const WRANGLER = join(process.cwd(), 'node_modules', '.bin', 'wrangler');

class ReleaseError extends Error {}

const parseArgs = (argv) => {
  const args = { promote: true, secretsFile: null, message: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-promote') args.promote = false;
    else if (arg === '--secrets-file') args.secretsFile = argv[++i];
    else if (arg === '--message') args.message = argv[++i];
    else throw new ReleaseError(`Unknown argument: ${arg}`);
  }
  if (args.secretsFile === undefined || args.message === undefined) {
    throw new ReleaseError('--secrets-file and --message need a value');
  }
  return args;
};

const log = (msg) => console.error(`\n[release] ${msg}`);

const wrangler = (args, { json = false, env } = {}) => {
  const result = spawnSync(WRANGLER, args, {
    stdio: json ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new ReleaseError(`wrangler ${args.join(' ')} exited with ${result.status}`);
  return json ? JSON.parse(result.stdout) : null;
};

const secretNames = (versionId) => {
  const version = wrangler(['versions', 'view', versionId, '--json'], { json: true });
  return version.resources.bindings.filter((b) => b.type === 'secret_text').map((b) => b.name);
};

const activeDeployment = () => {
  try {
    return wrangler(['deployments', 'status', '--json'], { json: true });
  } catch (error) {
    // First deployment of the Worker: nothing to compare or roll back to.
    log(`No active deployment found (${error.message}).`);
    return null;
  }
};

const defaultMessage = () => {
  const git = spawnSync('git', ['log', '-1', '--format=%h %s'], { encoding: 'utf8' });
  return git.status === 0 ? git.stdout.trim().slice(0, 100) : 'release';
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 200 (event data) or 404 event_not_found both mean the handler reached
// Supabase with the service-role key; a missing secret answers 500.
const smokeTest = async (baseUrl) => {
  const url = `${baseUrl.replace(/\/$/, '')}${SMOKE_PATH}`;
  let last = '';
  for (let attempt = 1; attempt <= SMOKE_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
      const body = await res.text();
      const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
      if ((res.status === 200 || res.status === 404) && isJson) {
        log(`Smoke test OK: GET ${url} -> ${res.status}`);
        return;
      }
      last = `${res.status} ${body.slice(0, 200)}`;
    } catch (error) {
      last = error.message;
    }
    log(`Smoke test attempt ${attempt}/${SMOKE_ATTEMPTS} failed: GET ${url} -> ${last}`);
    if (attempt < SMOKE_ATTEMPTS) await sleep(SMOKE_DELAY_MS);
  }
  throw new ReleaseError(`Smoke test failed for ${url}: ${last}`);
};

const upload = (args) => {
  const outDir = mkdtempSync(join(tmpdir(), 'wrangler-release-'));
  const outFile = join(outDir, 'output.ndjson');
  try {
    const cmd = ['versions', 'upload', '--message', args.message];
    if (args.secretsFile) cmd.push('--secrets-file', args.secretsFile);
    // WRANGLER_OUTPUT_FILE_PATH: wrangler appends one JSON entry per command,
    // the stable way to get the version id and Preview URL.
    wrangler(cmd, { env: { WRANGLER_OUTPUT_FILE_PATH: outFile } });
    const entry = readFileSync(outFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((e) => e.type === 'version-upload');
    if (!entry?.version_id)
      throw new ReleaseError('wrangler did not report the uploaded version id');
    return { versionId: entry.version_id, previewUrl: entry.preview_url ?? null };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  args.message ??= defaultMessage();

  const config = unstable_readConfig({ config: 'wrangler.jsonc' });
  const prodUrl = config.vars?.PUBLIC_BASE_URL;
  if (!prodUrl) throw new ReleaseError('PUBLIC_BASE_URL missing from wrangler.jsonc vars');

  log(`Worker ${config.name}: reading the active deployment`);
  const previous = activeDeployment();
  const previousSecrets = new Set(
    (previous?.versions ?? []).flatMap((v) => secretNames(v.version_id))
  );

  log('Uploading a new version (0% traffic)');
  const { versionId, previewUrl } = upload(args);

  log(`Checking secrets of ${versionId}`);
  const secrets = new Set(secretNames(versionId));
  console.error(`  ${secrets.size} secrets: ${[...secrets].sort().join(', ') || '(none)'}`);
  const missingRequired = REQUIRED_SECRETS.filter((name) => !secrets.has(name));
  const lost = [...previousSecrets].filter((name) => !secrets.has(name));
  if (missingRequired.length > 0 || lost.length > 0) {
    if (missingRequired.length > 0)
      console.error(`  MISSING required: ${missingRequired.join(', ')}`);
    if (lost.length > 0) console.error(`  MISSING vs. the live deployment: ${lost.join(', ')}`);
    throw new ReleaseError(
      `Version ${versionId} is missing secrets; NOT promoted (production untouched). The secret chain is ` +
        'broken: re-run with --secrets-file secrets.json (docs/deploy-cloudflare.md, "Releases seguros").'
    );
  }

  if (!previewUrl) {
    throw new ReleaseError(
      `Version ${versionId} has no Preview URL to smoke-test (preview_urls disabled?); NOT promoted.`
    );
  }
  await smokeTest(previewUrl);

  if (!args.promote) {
    log(`Verified, not promoted. To release:\n  npx wrangler versions deploy ${versionId}@100% -y`);
    return;
  }

  log(`Promoting ${versionId} to 100%`);
  wrangler(['versions', 'deploy', `${versionId}@100%`, '--message', args.message, '-y']);

  try {
    await smokeTest(prodUrl);
  } catch (error) {
    if (!previous) throw error;
    const specs = previous.versions.map((v) => `${v.version_id}@${v.percentage}%`);
    log(`Production smoke test failed; rolling back to ${specs.join(' ')}`);
    wrangler(['versions', 'deploy', ...specs, '--message', `auto-rollback of ${versionId}`, '-y']);
    throw error;
  }
  log(`Released ${versionId} to ${prodUrl}`);
};

main().catch((error) => {
  console.error(`\n[release] FAILED: ${error.message}`);
  if (!(error instanceof ReleaseError)) console.error(error.stack);
  process.exit(1);
});
