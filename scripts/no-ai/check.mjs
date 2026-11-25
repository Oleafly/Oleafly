import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const policy = JSON.parse(read('fork/removed-paths.json'));
const state = JSON.parse(read('fork/upstream.json'));
const errors = [];
for (const name of [...policy.directories, ...policy.files]) {
  if (fs.existsSync(path.join(root, name))) errors.push(`Removed AI path returned: ${name}`);
}
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
try {
  assert.deepEqual(config.plugins.updater.endpoints, [
    `https://github.com/${state.fork}/releases/latest/download/latest.json`,
  ]);
  assert.equal(config.plugins.updater.pubkey, read('fork/updater.pub').trim(), 'Updater signing key changed');
  assert.equal(JSON.parse(read('package.json')).version, config.version);
  assert.equal(state.releaseTag, `v${config.version}-noai.1`);
} catch (error) {
  errors.push(error.message);
}
for (const file of ['package.json', 'pnpm-lock.yaml', 'Cargo.lock', 'src-tauri/Cargo.toml']) {
  if (/(?:@oleafly\/ai-(?:core|tools)|name = "oleafly-(?:agent|acp)")/.test(read(file))) {
    errors.push(`AI dependency returned in ${file}`);
  }
}
const native = read('src-tauri/src/lib.rs');
if (/\b(?:agent|acp|ai_model_registry|mcp|skills|chats|research_tasks|cua_driver|library_db)::/.test(native)) {
  errors.push('An AI runtime or command was registered again');
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('No-AI modules, dependencies, native registration and fork updater verified.');
}
