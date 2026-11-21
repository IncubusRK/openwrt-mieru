'use strict';
/*
 * i18n coverage check: every _('...') / _("...") literal in the LuCI views
 * must have a msgid in po/templates/mieru.pot and a non-empty translation
 * in po/ru/mieru.po. Run: node tests/i18n-check.cjs
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const VIEW_DIR = path.join(ROOT, 'luci-app-mieru', 'htdocs', 'luci-static', 'resources', 'view', 'mieru');

function walk(dir) {
	let out = [];
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) out = out.concat(walk(p));
		else if (e.name.endsWith('.js')) out.push(p);
	}
	return out;
}

function extractStrings(src) {
	const found = new Set();
	const re = /\b_\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*[,)]/g;
	let m;
	while ((m = re.exec(src)) !== null) {
		const raw = m[1];
		const body = raw.slice(1, -1);
		const unescaped = body.replace(/\\(['"\\nrt])/g, (_, c) =>
			({ n: '\n', r: '\r', t: '\t' }[c] || c));
		found.add(unescaped);
	}
	return found;
}

function parsePo(file) {
	const src = fs.readFileSync(file, 'utf8');
	const entries = new Map();
	const re = /msgid\s+("(?:[^"\\]|\\.)*"(?:\s*"(?:[^"\\]|\\.)*")*)\s*\nmsgstr\s+("(?:[^"\\]|\\.)*"(?:\s*"(?:[^"\\]|\\.)*")*)/g;
	let m;
	const unquote = (s) => s.match(/"(?:[^"\\]|\\.)*"/g)
		.map(x => x.slice(1, -1).replace(/\\(["\\nrt])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' }[c] || c)))
		.join('');
	while ((m = re.exec(src)) !== null) {
		const id = unquote(m[1]);
		if (id === '') continue; // header
		entries.set(id, unquote(m[2]));
	}
	return entries;
}

const used = new Set();
for (const f of walk(VIEW_DIR))
	for (const s of extractStrings(fs.readFileSync(f, 'utf8')))
		used.add(s);

const pot = parsePo(path.join(ROOT, 'luci-app-mieru', 'po', 'templates', 'mieru.pot'));
const ru = parsePo(path.join(ROOT, 'luci-app-mieru', 'po', 'ru', 'mieru.po'));

let fail = 0;
const missingPot = [...used].filter(s => !pot.has(s));
const missingRu = [...used].filter(s => !ru.has(s));
const emptyRu = [...used].filter(s => ru.has(s) && ru.get(s) === '');
const stalePot = [...pot.keys()].filter(s => !used.has(s));
const staleRu = [...ru.keys()].filter(s => !used.has(s));

if (missingPot.length) { fail = 1; console.error('Missing in pot:\n  ' + missingPot.join('\n  ')); }
if (missingRu.length) { fail = 1; console.error('Missing in ru:\n  ' + missingRu.join('\n  ')); }
if (emptyRu.length) { fail = 1; console.error('Empty ru translation:\n  ' + emptyRu.join('\n  ')); }
if (stalePot.length) console.warn('Stale pot entries (not used in views):\n  ' + stalePot.join('\n  '));
if (staleRu.length) console.warn('Stale ru entries (not used in views):\n  ' + staleRu.join('\n  '));

console.log(`i18n: ${used.size} strings used, ${pot.size} in pot, ${ru.size} in ru`);
if (!fail) console.log('i18n coverage OK');
process.exit(fail);