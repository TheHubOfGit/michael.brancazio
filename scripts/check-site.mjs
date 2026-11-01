import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Script } from 'node:vm';
import { parse } from 'parse5';
import { projectRoot, publicEntries, publicPages } from './site-files.mjs';

const failures = [];
let scripts = 0;
let references = 0;

function walk(node, callback) {
  callback(node);
  for (const child of node.childNodes || []) walk(child, callback);
  if (node.content) walk(node.content, callback);
}

function checkScript(source, filename, isModule = false) {
  scripts++;
  try {
    if (isModule) {
      const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: source, encoding: 'utf8' });
      if (result.error || result.status !== 0) throw result.error || new Error(result.stderr);
    } else {
      new Script(source, { filename });
    }
  } catch (error) {
    failures.push(`${filename}: ${error.message}`);
  }
}

function isPublic(path) {
  return publicEntries.some((entry) => path === entry || path.startsWith(`${entry}/`));
}

for (const page of publicPages) {
  const html = await readFile(resolve(projectRoot, page), 'utf8');
  const document = parse(html, { sourceCodeLocationInfo: true });
  const ids = new Set();
  const localReferences = [];
  const fragments = [];
  walk(document, (node) => {
    const attrs = Object.fromEntries((node.attrs || []).map(({ name, value }) => [name, value]));
    const location = `${page}:${node.sourceCodeLocation?.startLine || 1}`;
    if (attrs.id) {
      if (ids.has(attrs.id)) failures.push(`${location}: duplicate id "${attrs.id}"`);
      ids.add(attrs.id);
    }
    if (node.tagName === 'html' && !attrs.lang) failures.push(`${page}: missing document language`);
    if (node.tagName === 'script' && !attrs.src) {
      const type = (attrs.type || '').toLowerCase();
      const source = (node.childNodes || []).map((child) => child.value || '').join('');
      if (!type || ['text/javascript', 'application/javascript', 'module'].includes(type)) {
        checkScript(source, location, type === 'module');
      } else if (type === 'application/ld+json') {
        try { JSON.parse(source); } catch (error) { failures.push(`${location}: invalid structured data: ${error.message}`); }
      }
    }
    for (const name of ['href', 'src', 'data-src', 'poster']) {
      const value = attrs[name];
      if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) continue;
      if (value.startsWith('#')) {
        if (value.length > 1) fragments.push({ location, id: value.slice(1) });
      } else {
        localReferences.push({ location, value });
      }
    }
  });
  for (const { location, id } of fragments) {
    if (!ids.has(decodeURIComponent(id))) failures.push(`${location}: missing anchor #${id}`);
  }
  for (const { location, value } of localReferences) {
    references++;
    const pathname = decodeURIComponent(value.split(/[?#]/, 1)[0]);
    const target = resolve(projectRoot, dirname(page), pathname.replace(/^\//, ''));
    const local = relative(projectRoot, target).split(sep).join('/');
    if (!isPublic(local)) {
      failures.push(`${location}: local reference is outside the public build: ${value}`);
      continue;
    }
    try { await stat(target); } catch { failures.push(`${location}: missing local file ${value}`); }
  }
}

async function checkAssetScripts(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) await checkAssetScripts(file);
    else if (extname(file) === '.js') checkScript(await readFile(file, 'utf8'), relative(projectRoot, file));
    else if (extname(file) === '.css') {
      const css = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const match of css.matchAll(/url\(\s*(['"]?)([^'"()]+)\1\s*\)/g)) {
        const value = match[2].trim();
        if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) continue;
        references++;
        const pathname = decodeURIComponent(value.split(/[?#]/, 1)[0]);
        const target = resolve(pathname.startsWith('/') ? projectRoot : dirname(file), pathname.replace(/^\//, ''));
        const local = relative(projectRoot, target).split(sep).join('/');
        const location = relative(projectRoot, file);
        if (!isPublic(local)) failures.push(`${location}: CSS asset is outside the public build: ${value}`);
        else {
          try { await stat(target); } catch { failures.push(`${location}: missing CSS asset ${value}`); }
        }
      }
    }
  }
}
await checkAssetScripts(resolve(projectRoot, 'assets'));

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${publicPages.length} pages, ${scripts} JavaScript blocks/files, and ${references} local references.`);
}
