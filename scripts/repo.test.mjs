// The repository holds several plugins and one catalog. These checks keep them consistent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlugin } from '../plugins/motion-flow/scripts/validate_plugin.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const json = (rel) => JSON.parse(readFileSync(join(REPO, rel), 'utf8'));
const catalog = json('.claude-plugin/marketplace.json');

test('every catalog entry points at a plugin folder whose manifest has the same name', () => {
  assert.ok(catalog.plugins.length >= 2);
  for (const entry of catalog.plugins) {
    assert.match(entry.source, /^\.\/plugins\/[a-z-]+$/, entry.name);
    assert.ok(existsSync(join(REPO, entry.source, '.claude-plugin', 'plugin.json')), `${entry.source} has no plugin.json`);
    assert.equal(json(`${entry.source}/.claude-plugin/plugin.json`).name, entry.name);
  }
});

test('the plugins are released together: they have the same version', () => {
  const versions = catalog.plugins.map((entry) => json(`${entry.source}/.claude-plugin/plugin.json`).version);
  assert.equal(new Set(versions).size, 1, `versions differ: ${versions.join(', ')}`);
});

test('every plugin passes the plugin validator', () => {
  for (const entry of catalog.plugins) assert.deepEqual(validatePlugin(join(REPO, entry.source)), [], entry.name);
});

test('every plugin has package.json with "type": "module", so extension-less bin scripts run as modules', () => {
  for (const entry of catalog.plugins) assert.equal(json(`${entry.source}/package.json`).type, 'module', entry.name);
});
