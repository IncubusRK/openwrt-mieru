'use strict';
/*
 * Tests for the mieru share-link parser/generator and UCI/JSON mapping.
 * Run: node --test tests/
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* Load mieru-link.js the way the LuCI loader does: evaluate the module with
 * a baseclass shim, take the returned class and instantiate it. */
const LINK_PATH = path.join(__dirname, '..', 'luci-app-mieru', 'htdocs',
	'luci-static', 'resources', 'view', 'mieru', 'mieru-link.js');

const baseclass = {
	extend(properties) {
		function LinkClass() {}
		Object.assign(LinkClass.prototype, properties);
		return LinkClass;
	}
};

const factory = new Function('baseclass', 'module', fs.readFileSync(LINK_PATH, 'utf8'));
const MieruLink = factory(baseclass, { exports: {} });
const L = new MieruLink();

/* Example from upstream docs/client-install.md (v3.39.0) — compatibility anchor. */
const UPSTREAM_DOC_LINK =
	'mierus://baozi:manlianpenfen@1.2.3.4?handshake-mode=HANDSHAKE_NO_WAIT&mtu=1400' +
	'&multiplexing=MULTIPLEXING_HIGH&port=6666&port=9998-9999&port=6489&port=4896' +
	'&profile=default&protocol=TCP&protocol=TCP&protocol=UDP&protocol=UDP' +
	'&traffic-pattern=CCoQARoECAEQCiIYCAMQASoIMDAwMTAyMDMqCDA0MDUwNjA3';

const UPSTREAM_DOC_BINDINGS = [
	{ port: '6666', protocol: 'TCP' },
	{ port: '9998-9999', protocol: 'TCP' },
	{ port: '6489', protocol: 'UDP' },
	{ port: '4896', protocol: 'UDP' }
];

function cfg(over) {
	return Object.assign({
		server_addr: '1.2.3.4',
		username: 'user',
		password: 'pass',
		profile: 'default',
		mtu: 1400,
		multiplexing: 'MULTIPLEXING_LOW',
		handshake_mode: 'HANDSHAKE_STANDARD',
		traffic_pattern: '',
		bindings: [{ port: '2012', protocol: 'TCP' }]
	}, over || {});
}

function mustParse(link) {
	const r = L.parseLink(link);
	assert.strictEqual(r.ok, true, 'expected success, got: ' + r.error);
	return r;
}

function mustFail(link, re) {
	const r = L.parseLink(link);
	assert.strictEqual(r.ok, false, 'expected failure for: ' + link);
	if (re) assert.match(r.error, re);
	return r;
}

test('parsePortSpec: single ports and ranges', () => {
	assert.deepStrictEqual(L.parsePortSpec('2012'), { ok: true, port: '2012', start: 2012, end: 2012 });
	assert.deepStrictEqual(L.parsePortSpec('2020-2030'), { ok: true, port: '2020-2030', start: 2020, end: 2030 });
	assert.strictEqual(L.parsePortSpec('1').ok, true);
	assert.strictEqual(L.parsePortSpec('65535').ok, true);
	assert.strictEqual(L.parsePortSpec('1-65535').ok, true);
	assert.strictEqual(L.parsePortSpec('2020-2020').ok, true); // start == end is legal
});

test('parsePortSpec: normalization (leading zeros, unicode dashes, spaces)', () => {
	assert.strictEqual(L.parsePortSpec('02012').port, '2012');
	assert.strictEqual(L.parsePortSpec('2020\u20132030').port, '2020-2030'); // en dash
	assert.strictEqual(L.parsePortSpec('2020\u20142030').port, '2020-2030'); // em dash
	assert.strictEqual(L.parsePortSpec('2020 \u2212 2030').port, '2020-2030'); // minus + spaces
});

test('parsePortSpec: invalid values', () => {
	for (const bad of ['', '0', '65536', 'abc', '2030-2020', '1-2-3', '-2030', '2020-', '2020-0', '65536-65537', '12.5'])
		assert.strictEqual(L.parsePortSpec(bad).ok, false, 'should reject: ' + bad);
	assert.match(L.parsePortSpec('2030-2020').error, /start is greater than end/);
	assert.match(L.parsePortSpec('65536').error, /1-65535/);
});

test('parseLink: single port canonical', () => {
	const r = mustParse('mierus://user:pass@1.2.3.4?profile=default&port=2012&protocol=TCP&mtu=1400&multiplexing=MULTIPLEXING_LOW&handshake-mode=HANDSHAKE_STANDARD');
	assert.deepStrictEqual(r.config, cfg());
	assert.deepStrictEqual(r.warnings, []);
});

test('parseLink: upstream documentation example (multi-port, ranges, TCP/UDP, traffic-pattern)', () => {
	const r = mustParse(UPSTREAM_DOC_LINK);
	assert.strictEqual(r.config.server_addr, '1.2.3.4');
	assert.strictEqual(r.config.username, 'baozi');
	assert.strictEqual(r.config.password, 'manlianpenfen');
	assert.strictEqual(r.config.profile, 'default');
	assert.strictEqual(r.config.mtu, 1400);
	assert.strictEqual(r.config.multiplexing, 'MULTIPLEXING_HIGH');
	assert.strictEqual(r.config.handshake_mode, 'HANDSHAKE_NO_WAIT');
	assert.strictEqual(r.config.traffic_pattern, 'CCoQARoECAEQCiIYCAMQASoIMDAwMTAyMDMqCDA0MDUwNjA3');
	assert.deepStrictEqual(r.config.bindings, UPSTREAM_DOC_BINDINGS);
});

test('generateLink: reproduces the upstream documentation example byte-for-byte', () => {
	const r = mustParse(UPSTREAM_DOC_LINK);
	assert.strictEqual(L.generateLink(r.config), UPSTREAM_DOC_LINK);
});

test('parseLink: port/protocol pairing is by index, not adjacency', () => {
	const r = mustParse('mierus://u:p@h?port=1000&port=2000-2005&protocol=UDP&protocol=TCP&profile=x');
	assert.deepStrictEqual(r.config.bindings, [
		{ port: '1000', protocol: 'UDP' },
		{ port: '2000-2005', protocol: 'TCP' }
	]);
	assert.strictEqual(r.config.profile, 'x');
});

test('parseLink: compact list with per-binding /TCP|/UDP suffixes', () => {
	const r = mustParse('mierus://user:pass@1.2.3.4?port=2012,2020-2030/UDP,3000/TCP&profile=default');
	assert.deepStrictEqual(r.config.bindings, [
		{ port: '2012', protocol: 'TCP' },
		{ port: '2020-2030', protocol: 'UDP' },
		{ port: '3000', protocol: 'TCP' }
	]);
});

test('parseLink: compact list default protocol from single protocol= parameter', () => {
	const r = mustParse('mierus://user:pass@1.2.3.4?port=2012,2020-2030&protocol=UDP');
	assert.deepStrictEqual(r.config.bindings, [
		{ port: '2012', protocol: 'UDP' },
		{ port: '2020-2030', protocol: 'UDP' }
	]);
});

test('parseLink: compact list rejects ambiguous multiple protocol parameters', () => {
	mustFail('mierus://u:p@h?port=2012,2020&protocol=TCP&protocol=UDP', /compact port list/);
});

test('parseLink: compact list invalid elements', () => {
	mustFail('mierus://u:p@h?port=2012,,2020', /empty element/);
	mustFail('mierus://u:p@h?port=2012/ICMP', /protocol suffix/);
	mustFail('mierus://u:p@h?port=2012,70000', /1-65535/);
	mustFail('mierus://u:p@h?port=2030-2020/UDP', /start is greater than end/);
});

test('parseLink: authority port fallback (lenient)', () => {
	const r = mustParse('mierus://user:pass@1.2.3.4:2012');
	assert.deepStrictEqual(r.config.bindings, [{ port: '2012', protocol: 'TCP' }]);
	assert.ok(r.warnings.some(w => /authority/.test(w)));
	const r2 = mustParse('mierus://user:pass@1.2.3.4:2012?protocol=UDP');
	assert.deepStrictEqual(r2.config.bindings, [{ port: '2012', protocol: 'UDP' }]);
	mustFail('mierus://user:pass@1.2.3.4:2020-2030', /range in the URL authority/);
});

test('parseLink: IPv6 host in brackets', () => {
	const r = mustParse('mierus://user:pass@[2001:db8::1]?port=2012&protocol=TCP&profile=default');
	assert.strictEqual(r.config.server_addr, '2001:db8::1');
	assert.ok(L.generateLink(r.config).indexOf('@[2001:db8::1]?') !== -1);
	mustFail('mierus://u:p@[2001:db8::1?port=1', /IPv6 bracket/);
});

test('parseLink: percent-encoded credentials with special characters', () => {
	const r = mustParse('mierus://user%40mail:p%40ss%3Aword%20x@host.example?port=2012&protocol=TCP');
	assert.strictEqual(r.config.username, 'user@mail');
	assert.strictEqual(r.config.password, 'p@ss:word x');
	const link = L.generateLink(r.config);
	const r2 = mustParse(link);
	assert.deepStrictEqual(r2.config, r.config);
});

test('parseLink: fragment, surrounding quotes and whitespace are tolerated', () => {
	const r = mustParse('  "mierus://user:pass@1.2.3.4?port=2012&protocol=TCP#my%20server"  ');
	assert.strictEqual(r.config.server_addr, '1.2.3.4');
	assert.strictEqual(r.remark, 'my server');
});

test('parseLink: lenient defaults (profile, protocol, short enum names)', () => {
	const r = mustParse('mierus://u:p@h?port=2012&multiplexing=high&handshake-mode=no_wait');
	assert.strictEqual(r.config.profile, 'default');
	assert.deepStrictEqual(r.config.bindings, [{ port: '2012', protocol: 'TCP' }]);
	assert.strictEqual(r.config.multiplexing, 'MULTIPLEXING_HIGH');
	assert.strictEqual(r.config.handshake_mode, 'HANDSHAKE_NO_WAIT');
	assert.ok(r.warnings.some(w => /defaulting every binding to TCP/.test(w)));
});

test('parseLink: invalid inputs', () => {
	mustFail('', /no URL/);
	mustFail('https://example.com', /scheme/);
	mustFail('mierus://host?port=2012', /user info/);
	mustFail('mierus://:pass@host?port=2012', /user name/);
	mustFail('mierus://user:@host?port=2012', /password/);
	mustFail('mierus://user:pass@?port=2012', /no host/);
	mustFail('mierus://user:pass@host', /no port/);
	mustFail('mierus://u:p@h?port=0&protocol=TCP', /1-65535/);
	mustFail('mierus://u:p@h?port=65536&protocol=TCP', /1-65535/);
	mustFail('mierus://u:p@h?port=2030-2020&protocol=TCP', /start is greater than end/);
	mustFail('mierus://u:p@h?port=2012&port=2013&protocol=TCP', /mismatched number/);
	mustFail('mierus://u:p@h?port=2012&protocol=SCTP', /invalid protocol/);
	mustFail('mierus://u:p@h?port=2012&mtu=9000', /MTU/);
	mustFail('mierus://u:p@h?port=2012&mtu=abc', /invalid MTU/);
	mustFail('mierus://u:p@h?port=2012&multiplexing=BOGUS', /multiplexing/);
	mustFail('mierus://u:p@h?port=2012&handshake-mode=BOGUS', /handshake/);
	mustFail('mierus://u:p@h?port=2012&traffic-pattern=%%%not-base64', /base64/);
});

test('parseLink: standard mieru:// links are detected and routed to the binary', () => {
	const r = L.parseLink('mieru://CpsBCgdkZWZhdWx0');
	assert.strictEqual(r.ok, false);
	assert.strictEqual(r.standard, true);
});

test('round-trip: parse -> generate -> parse is semantically lossless', () => {
	const links = [
		UPSTREAM_DOC_LINK,
		'mierus://user:pass@1.2.3.4?port=2012&protocol=TCP&profile=default&mtu=1400&multiplexing=MULTIPLEXING_LOW&handshake-mode=HANDSHAKE_STANDARD',
		'mierus://u:p@host.example?port=2012,2020-2030/UDP,3000/TCP&profile=default',
		'mierus://user%40mail:p%40ss%3Aword%20x@[2001:db8::1]?port=1-65535&protocol=UDP&profile=pr%20ofile&mtu=1280&multiplexing=MULTIPLEXING_OFF&handshake-mode=HANDSHAKE_NO_WAIT',
		'mierus://u:p@h?port=2012&port=2013&port=2014-2020&protocol=TCP&protocol=UDP&protocol=TCP&profile=default'
	];
	for (const link of links) {
		const first = mustParse(link);
		const regenerated = L.generateLink(first.config);
		const second = mustParse(regenerated);
		assert.deepStrictEqual(second.config, first.config, 'round-trip mismatch for: ' + link);
		assert.strictEqual(L.generateLink(second.config), regenerated, 'generator is not stable');
	}
});

test('round-trip: compact import -> canonical export keeps every binding', () => {
	const r = mustParse('mierus://user:pass@1.2.3.4?port=2012,2020-2030/UDP&profile=default&mtu=1300&multiplexing=MULTIPLEXING_MIDDLE');
	const link = L.generateLink(r.config);
	assert.ok(link.indexOf('port=2012&port=2020-2030') !== -1);
	assert.ok(link.indexOf('protocol=TCP&protocol=UDP') !== -1);
	assert.ok(link.indexOf('mtu=1300') !== -1);
	assert.ok(link.indexOf('multiplexing=MULTIPLEXING_MIDDLE') !== -1);
	const back = mustParse(link);
	assert.deepStrictEqual(back.config.bindings, r.config.bindings);
});

test('validateBindings: overlap warnings per protocol', () => {
	const v = L.validateBindings([
		{ port: '2012', protocol: 'TCP' },
		{ port: '2010-2020', protocol: 'TCP' },
		{ port: '2012', protocol: 'UDP' },
		{ port: '3000-3010', protocol: 'UDP' },
		{ port: '3005-3020', protocol: 'UDP' }
	]);
	assert.deepStrictEqual(v.errors, []);
	assert.strictEqual(v.warnings.length, 2);
	assert.ok(v.warnings[0].indexOf('overlap on TCP') !== -1);
	assert.ok(v.warnings[1].indexOf('overlap on UDP') !== -1);
});

test('validateBindings: same port on TCP and UDP is fine, duplicates warn', () => {
	const ok = L.validateBindings([
		{ port: '2012', protocol: 'TCP' },
		{ port: '2012', protocol: 'UDP' }
	]);
	assert.deepStrictEqual(ok.warnings, []);
	const dup = L.validateBindings([
		{ port: '2012', protocol: 'TCP' },
		{ port: '2012', protocol: 'TCP' }
	]);
	assert.strictEqual(dup.warnings.length, 1);
	assert.match(dup.warnings[0], /identical/);
});

test('validateBindings: errors on bad specs and empty list', () => {
	assert.strictEqual(L.validateBindings([]).errors.length, 1);
	assert.strictEqual(L.validateBindings([{ port: '0', protocol: 'TCP' }]).errors.length, 1);
	assert.strictEqual(L.validateBindings([{ port: '2012', protocol: 'ICMP' }]).errors.length, 1);
});

test('generateLink: refuses incomplete or invalid configs', () => {
	assert.throws(() => L.generateLink(cfg({ server_addr: '' })), /server address/);
	assert.throws(() => L.generateLink(cfg({ username: '' })), /username/);
	assert.throws(() => L.generateLink(cfg({ password: '' })), /password/);
	assert.throws(() => L.generateLink(cfg({ bindings: [] })), /at least one/);
	assert.throws(() => L.generateLink(cfg({ bindings: [{ port: '70000', protocol: 'TCP' }] })), /1-65535/);
	assert.throws(() => L.generateLink(cfg({ mtu: 9000 })), /MTU/);
	assert.throws(() => L.generateLink(cfg({ traffic_pattern: '!!!' })), /base64/);
});

test('parseClientJson: upstream example config', () => {
	const json = JSON.stringify({
		profiles: [{
			profileName: 'default',
			user: { name: 'baozi', password: 'manlianpenfen' },
			servers: [{
				ipAddress: '1.2.3.4',
				portBindings: [
					{ portRange: '9998-9999', protocol: 'TCP' },
					{ port: 6489, protocol: 'UDP' }
				]
			}],
			mtu: 1400,
			multiplexing: { level: 'MULTIPLEXING_HIGH' },
			handshakeMode: 'HANDSHAKE_NO_WAIT'
		}],
		activeProfile: 'default',
		rpcPort: 8964,
		socks5Port: 1080,
		socks5ListenLAN: true,
		loggingLevel: 'ERROR'
	});
	const r = L.parseClientJson(json);
	assert.strictEqual(r.ok, true);
	assert.deepStrictEqual(r.config.bindings, [
		{ port: '9998-9999', protocol: 'TCP' },
		{ port: '6489', protocol: 'UDP' }
	]);
	assert.strictEqual(r.config.multiplexing, 'MULTIPLEXING_HIGH');
	assert.strictEqual(r.local.socks5_port, 1080);
	assert.strictEqual(r.local.rpc_port, 8964);
});

test('parseClientJson: trafficPattern object is dropped with a warning', () => {
	const r = L.parseClientJson(JSON.stringify({
		profiles: [{
			profileName: 'default',
			user: { name: 'u', password: 'p' },
			servers: [{ ipAddress: '1.2.3.4', portBindings: [{ port: 2012, protocol: 'TCP' }] }],
			trafficPattern: { seed: 42, unlockAll: true }
		}]
	}));
	assert.strictEqual(r.ok, true);
	assert.strictEqual(r.config.traffic_pattern, '');
	assert.ok(r.warnings.some(w => /trafficPattern/.test(w)));
});

test('parseClientJson: invalid inputs', () => {
	assert.strictEqual(L.parseClientJson('not json').ok, false);
	assert.strictEqual(L.parseClientJson('{}').ok, false);
	assert.strictEqual(L.parseClientJson('{"profiles":[]}').ok, false);
	assert.strictEqual(L.parseClientJson(JSON.stringify({
		profiles: [{ profileName: 'x', user: { name: 'u' }, servers: [] }]
	})).ok, false);
});

test('generateClientJson: matches the daemon config shape', () => {
	const out = L.generateClientJson(cfg({
		server_addr: 'proxy.example.com',
		bindings: [
			{ port: '2012', protocol: 'TCP' },
			{ port: '2020-2030', protocol: 'UDP' }
		]
	}), { socks5_port: '1080', rpc_port: '8964', socks5_listen_lan: true, log_level: 'ERROR', http_proxy_port: '8080', http_proxy_listen_lan: false });
	assert.strictEqual(out.activeProfile, 'default');
	assert.strictEqual(out.socks5Port, 1080);
	assert.strictEqual(out.socks5ListenLAN, true);
	assert.strictEqual(out.rpcPort, 8964);
	assert.strictEqual(out.loggingLevel, 'ERROR');
	assert.strictEqual(out.httpProxyPort, 8080);
	assert.strictEqual(out.httpProxyListenLAN, false);
	const prof = out.profiles[0];
	assert.strictEqual(prof.profileName, 'default');
	assert.strictEqual(prof.mtu, 1400);
	assert.deepStrictEqual(prof.multiplexing, { level: 'MULTIPLEXING_LOW' });
	assert.strictEqual(prof.handshakeMode, 'HANDSHAKE_STANDARD');
	assert.deepStrictEqual(prof.user, { name: 'user', password: 'pass' });
	assert.deepStrictEqual(prof.servers[0].domainName, 'proxy.example.com');
	assert.deepStrictEqual(prof.servers[0].portBindings, [
		{ port: 2012, protocol: 'TCP' },
		{ portRange: '2020-2030', protocol: 'UDP' }
	]);
});

test('generateClientJson: IPv4 address goes to ipAddress, no http proxy by default', () => {
	const out = L.generateClientJson(cfg(), {});
	assert.strictEqual(out.profiles[0].servers[0].ipAddress, '1.2.3.4');
	assert.strictEqual(out.httpProxyPort, undefined);
});

test('UCI mapping: link -> UCI -> link is lossless (main + port_binding sections)', () => {
	const r = mustParse('mierus://user:pass@1.2.3.4?port=2012,2020-2030/UDP,3000/TCP&profile=default&mtu=1300&multiplexing=MULTIPLEXING_HIGH&handshake-mode=HANDSHAKE_NO_WAIT');
	const uci = L.configToUci(r.config);
	assert.strictEqual(uci.main.port, '2012');
	assert.strictEqual(uci.main.protocol, 'TCP');
	assert.strictEqual(uci.main.mtu, '1300');
	assert.deepStrictEqual(uci.bindings, [
		{ port: '2020-2030', protocol: 'UDP' },
		{ port: '3000', protocol: 'TCP' }
	]);
	const back = L.configFromUci(uci.main, uci.bindings);
	assert.deepStrictEqual(back, r.config);
	assert.strictEqual(L.generateLink(back), L.generateLink(r.config));
});

test('UCI mapping: defaults are applied for empty options', () => {
	const c = L.configFromUci({ port: '2012' }, []);
	assert.strictEqual(c.profile, 'default');
	assert.strictEqual(c.mtu, 1400);
	assert.strictEqual(c.multiplexing, 'MULTIPLEXING_LOW');
	assert.strictEqual(c.handshake_mode, 'HANDSHAKE_STANDARD');
	assert.deepStrictEqual(c.bindings, [{ port: '2012', protocol: 'TCP' }]);
});