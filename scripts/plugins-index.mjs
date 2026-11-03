// Generates `plugins/index.json` for the PackPack plugin marketplace.
//
// The index is the marketplace's only input: it names each plugin, the files a
// client must fetch, and the SHA-256 of every one of them. It is generated
// rather than hand-written so a release cannot forget a hash, and the check
// next to it fails when a manifest changed without regenerating this file.
//
// Usage:
//   node scripts/plugins-index.mjs [--ref <commit-sha>]

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(root, 'plugins');
const indexPath = join(pluginsDir, 'index.json');

const CAPABILITIES = new Set(['map.read', 'map.write', 'ui.sidebar', 'ui.toolbar']);
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const LOCAL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PATH = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+$/;
const TAG = /^[a-z0-9][a-z0-9-]*$/;

function fail(message) {
  throw new Error(message);
}

function text(value, where, max = 500) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${where} must be a non-empty string`);
  if (value.length > max) fail(`${where} must be at most ${max} characters`);
  return value;
}

function optionalText(value, where, max = 500) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') fail(`${where} must be a string`);
  if (value.length > max) fail(`${where} must be at most ${max} characters`);
  return value;
}

function relativePath(value, where) {
  const result = text(value, where, 300);
  if (!PATH.test(result)) fail(`${where} must be a relative path without ".."`);
  return result;
}

function read(relative) {
  const full = join(root, relative);
  if (!existsSync(full)) fail(`${relative} is missing`);
  return readFileSync(full);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function localId(value, where) {
  const id = text(value, where, 64);
  if (!LOCAL_ID.test(id)) {
    fail(`${where} must be 1-64 characters of letters, digits, "-" or "_"`);
  }
  return id;
}

function tags(value, where) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${where} must be an array`);
  if (value.length > 10) fail(`${where} must hold at most 10 tags`);
  const result = [];
  for (const [index, item] of value.entries()) {
    const tag = text(item, `${where}[${index}]`, 24).trim().toLowerCase();
    if (!TAG.test(tag)) fail(`${where}[${index}] is not a tag`);
    if (!result.includes(tag)) result.push(tag);
  }
  return result;
}

function validateContributions(raw, capabilities, file) {
  const contributes = raw.contributes ?? {};
  if (contributes === null || typeof contributes !== 'object' || Array.isArray(contributes)) {
    fail(`${file}: contributes must be an object`);
  }

  const panels = contributes.panels ?? [];
  if (!Array.isArray(panels)) fail(`${file}: contributes.panels must be an array`);
  const panelIds = new Set();
  const sides = new Set();
  for (const [index, panel] of panels.entries()) {
    const where = `${file}: contributes.panels[${index}]`;
    if (panel === null || typeof panel !== 'object' || Array.isArray(panel)) {
      fail(`${where} must be an object`);
    }
    const id = localId(panel.id, `${where}.id`);
    if (panelIds.has(id)) fail(`${where}.id "${id}" is duplicated`);
    panelIds.add(id);
    text(panel.title, `${where}.title`, 80);
    if (panel.location !== 'left' && panel.location !== 'right') {
      fail(`${where}.location must be "left" or "right"`);
    }
    if (sides.has(panel.location)) fail(`${where}: one panel per plugin per side is allowed`);
    sides.add(panel.location);
    if (panel.order !== undefined && (typeof panel.order !== 'number' || !Number.isFinite(panel.order))) {
      fail(`${where}.order must be a number`);
    }
    if (!Array.isArray(panel.body)) fail(`${where}.body must be an array`);
  }
  if (panels.length > 0 && !capabilities.includes('ui.sidebar')) {
    fail(`${file}: contributes.panels requires the "ui.sidebar" capability`);
  }

  const commands = contributes.commands ?? [];
  if (!Array.isArray(commands)) fail(`${file}: contributes.commands must be an array`);
  const commandIds = new Set();
  for (const [index, command] of commands.entries()) {
    const where = `${file}: contributes.commands[${index}]`;
    if (command === null || typeof command !== 'object' || Array.isArray(command)) {
      fail(`${where} must be an object`);
    }
    const id = localId(command.id, `${where}.id`);
    if (commandIds.has(id)) fail(`${where}.id "${id}" is duplicated`);
    commandIds.add(id);
    text(command.title, `${where}.title`, 120);
    optionalText(command.icon, `${where}.icon`, 8192);
  }

  const toolbar = contributes.toolbar ?? [];
  if (!Array.isArray(toolbar)) fail(`${file}: contributes.toolbar must be an array`);
  for (const [index, item] of toolbar.entries()) {
    const where = `${file}: contributes.toolbar[${index}]`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      fail(`${where} must be an object`);
    }
    const command = localId(item.command, `${where}.command`);
    if (!commandIds.has(command)) {
      fail(`${where}.command "${command}" does not name a declared command`);
    }
    optionalText(item.title, `${where}.title`, 120);
    optionalText(item.icon, `${where}.icon`, 8192);
    if (item.order !== undefined && (typeof item.order !== 'number' || !Number.isFinite(item.order))) {
      fail(`${where}.order must be a number`);
    }
  }
  if (toolbar.length > 0 && !capabilities.includes('ui.toolbar')) {
    fail(`${file}: contributes.toolbar requires the "ui.toolbar" capability`);
  }
}

function readManifest(folder) {
  const manifestPath = `plugins/${folder}/manifest.json`;
  const raw = JSON.parse(read(manifestPath).toString('utf8'));
  const file = manifestPath;
  if (raw.version !== 2) fail(`${file}: version must be 2`);
  if (raw.uiVersion !== 1) fail(`${file}: uiVersion must be 1`);
  if (raw.apiVersion !== 2) fail(`${file}: apiVersion must be 2`);

  const id = text(raw.id, `${file}: id`, 64);
  if (!ID.test(id) || id.includes('..') || id.endsWith('.')) fail(`${file}: id is not usable`);
  if (id === 'builtin' || id.startsWith('builtin.')) fail(`${file}: id uses the reserved prefix`);
  if (id !== folder) fail(`${file}: id "${id}" must match the folder name`);

  const name = text(raw.name, `${file}: name`, 80);
  const pluginVersion = text(raw.pluginVersion, `${file}: pluginVersion`, 40);
  if (!SEMVER.test(pluginVersion)) fail(`${file}: pluginVersion must be a semantic version`);
  const minAppVersion = optionalText(raw.minAppVersion, `${file}: minAppVersion`, 40);
  if (minAppVersion !== undefined && !SEMVER.test(minAppVersion)) {
    fail(`${file}: minAppVersion must be a semantic version`);
  }

  const capabilities = raw.capabilities ?? [];
  if (!Array.isArray(capabilities)) fail(`${file}: capabilities must be an array`);
  for (const capability of capabilities) {
    if (!CAPABILITIES.has(capability)) fail(`${file}: unknown capability "${capability}"`);
  }

  const main = relativePath(raw.main, `${file}: main`);
  const readme = raw.readme === undefined ? undefined : relativePath(raw.readme, `${file}: readme`);
  const icon = raw.icon === undefined ? undefined : relativePath(raw.icon, `${file}: icon`);
  validateContributions(raw, capabilities, file);

  return {
    id,
    name,
    pluginVersion,
    description: optionalText(raw.description, `${file}: description`, 500) ?? '',
    author: optionalText(raw.author, `${file}: author`, 80),
    tags: tags(raw.tags, `${file}: tags`),
    apiVersion: raw.apiVersion,
    minAppVersion,
    main,
    readme,
    icon,
    manifestPath,
  };
}

/** Builds the index from the folders. */
export function buildIndex({ ref, generatedAt } = {}) {
  const targetRef = ref ?? 'main';
  const folders = readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const plugins = folders.map((folder) => {
    const manifest = readManifest(folder);
    const mainPath = `plugins/${folder}/${manifest.main}`;
    const readmePath = manifest.readme ? `plugins/${folder}/${manifest.readme}` : undefined;
    const iconPath = manifest.icon ? `plugins/${folder}/${manifest.icon}` : undefined;
    const main = read(mainPath);
    const readme = readmePath ? read(readmePath) : undefined;
    const icon = iconPath ? read(iconPath) : undefined;
    return {
      id: manifest.id,
      name: manifest.name,
      pluginVersion: manifest.pluginVersion,
      description: manifest.description,
      author: manifest.author,
      tags: manifest.tags,
      apiVersion: manifest.apiVersion,
      minAppVersion: manifest.minAppVersion,
      ref: targetRef,
      manifest: manifest.manifestPath,
      main: mainPath,
      readme: readmePath,
      icon: iconPath,
      sha256: {
        manifest: sha256(read(manifest.manifestPath)),
        main: sha256(main),
        ...(readme ? { readme: sha256(readme) } : {}),
        ...(icon ? { icon: sha256(icon) } : {}),
      },
    };
  });

  return {
    schema: 1,
    generatedAt: generatedAt ?? new Date().toISOString(),
    ref: targetRef,
    plugins: plugins.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Writes the index and returns it. */
export function writeIndex(options = {}) {
  const index = buildIndex(options);
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

function argument(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

if (process.argv[1]?.endsWith('plugins-index.mjs')) {
  const ref = argument('--ref') ?? process.env.GIT_COMMIT ?? undefined;
  const index = writeIndex(ref ? { ref } : {});
  console.log(`wrote plugins/index.json (${index.plugins.length} plugins, ref ${index.ref})`);
}
