#!/usr/bin/env node
// Stages the headless MCP server as its own npm package in build/npm-mcp.
//
// The VS Code extension's package.json is not publishable as an npm package: it ships the
// extension, tests and legacy scripts, and its postinstall (npm --prefix src/webview/frontend
// install) fails outside the repository. This script copies only what `rostooling-mcp` loads at
// runtime (the require closure of out/mcp/server.js), the language-server JAR, and writes a
// dedicated package.json whose dependencies are exactly the external modules of that closure.
//
// Usage: node npm/build-mcp-package.mjs [--name @rostooling/rostooling-mcp]
// Requires `npm run compile` and the server JAR in server/ (./gradlew copyFatJar).

import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'build', 'npm-mcp');
const nameArg = process.argv.indexOf('--name');
const name = nameArg > 0 ? process.argv[nameArg + 1] : '@rostooling/rostooling-mcp';

const ext = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const builtin = new Set(builtinModules);

// --- require closure of the MCP server -------------------------------------------------------
const files = new Set();
const externals = new Set();
function walk(file) {
  if (files.has(file)) return;
  files.add(file);
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/require\(["']([^"']+)["']\)/g)) {
    const req = m[1].replace(/^node:/, '');
    if (req.startsWith('.')) {
      let target = path.resolve(path.dirname(file), req);
      if (!target.endsWith('.js')) target += '.js';
      if (fs.existsSync(target)) walk(target);
    } else if (!builtin.has(req.split('/')[0])) {
      externals.add(req.startsWith('@') ? req.split('/').slice(0, 2).join('/') : req.split('/')[0]);
    }
  }
}
const entry = path.join(root, 'out', 'mcp', 'server.js');
if (!fs.existsSync(entry)) throw new Error(`${entry} missing: run "npm run compile" first`);
walk(entry);

const jars = fs.existsSync(path.join(root, 'server'))
  ? fs.readdirSync(path.join(root, 'server')).filter((f) => /^rostooling_extension-.*\.jar$/.test(f))
  : [];
if (jars.length !== 1) throw new Error(`expected exactly one server/rostooling_extension-*.jar, found ${jars.length}`);

// --- stage ---------------------------------------------------------------------------------------
fs.rmSync(outDir, { recursive: true, force: true });
const copy = (rel) => {
  fs.mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true });
  fs.copyFileSync(path.join(root, rel), path.join(outDir, rel));
};
copy('bin/rostooling-mcp.js');
for (const f of [...files].sort()) copy(path.relative(root, f));
copy(path.join('server', jars[0]));
copy('LICENSE');
fs.copyFileSync(path.join(root, 'npm', 'README.md'), path.join(outDir, 'README.md'));

// Dependency ranges: the extension's declared range, else the installed version.
const dependencies = {};
for (const dep of [...externals].sort()) {
  const declared = ext.dependencies?.[dep];
  if (declared) {
    dependencies[dep] = declared;
    continue;
  }
  const installed = path.join(root, 'node_modules', ...dep.split('/'), 'package.json');
  if (!fs.existsSync(installed)) throw new Error(`cannot determine a version for ${dep}`);
  dependencies[dep] = '^' + JSON.parse(fs.readFileSync(installed, 'utf8')).version;
}

const pkg = {
  name,
  version: ext.version,
  description: 'Headless MCP server for Fraunhofer IPA RosTooling: validate, author and generate ROS 2 models (.ros2, .rossystem) through the Java GLSP/Xtext model server.',
  license: ext.license,
  author: ext.author,
  homepage: ext.homepage,
  repository: ext.repository,
  bugs: ext.bugs,
  keywords: ['ros', 'ros2', 'mcp', 'model-context-protocol', 'xtext', 'glsp', 'rostooling'],
  bin: { 'rostooling-mcp': 'bin/rostooling-mcp.js' },
  engines: { node: '>=20' },
  dependencies,
  publishConfig: { access: 'public', provenance: true },
};
for (const k of Object.keys(pkg)) if (pkg[k] === undefined) delete pkg[k];
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

console.log(`Staged ${name}@${pkg.version} in ${path.relative(process.cwd(), outDir) || outDir}`);
console.log(`  ${files.size} JS files, server/${jars[0]}, dependencies: ${Object.keys(dependencies).join(', ')}`);
