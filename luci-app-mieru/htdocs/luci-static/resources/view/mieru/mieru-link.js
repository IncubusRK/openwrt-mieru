'use strict';
'require baseclass';
/*
 * mieru-link.js - parser/generator for mieru share links and client configs.
 *
 * Copyright (C) 2026 IncubusRK
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * LuCI's module loader requires every "view.*" module to return a class
 * constructor; the loader instantiates it and hands the requiring code an
 * instance. The node test suite (tests/mieru-link.test.cjs) mirrors this:
 * it evaluates the file through a Function wrapper with a baseclass shim
 * and instantiates the returned class.
 *
 * Canonical link format (compatible with upstream enfein/mieru
 * `mieru export config simple` / `mieru import config`):
 *
 *   mierus://user:pass@host?handshake-mode=...&mtu=...&multiplexing=...
 *           &port=P1&port=P2...&profile=...&protocol=PR1&protocol=PR2...
 *           [&traffic-pattern=base64]
 *
 * Query keys are sorted alphabetically (like Go url.Values.Encode());
 * port[i] and protocol[i] are paired by index. A port is a single number
 * (1-65535) or a range "start-end". Additionally accepted on import:
 *   - compact list: port=2012,2020-2030/UDP,3000/TCP (per-element protocol
 *     suffix, default from the single protocol= parameter or TCP);
 *   - authority port: mierus://user:pass@host:2012 (single TCP binding);
 *   - #fragment, surrounding quotes/whitespace, unicode dashes, short
 *     multiplexing/handshake names (LOW, NO_WAIT, ...).
 */

var MULTIPLEXING_LEVELS = [
	'MULTIPLEXING_OFF',
	'MULTIPLEXING_LOW',
	'MULTIPLEXING_MIDDLE',
	'MULTIPLEXING_HIGH'
];

var HANDSHAKE_MODES = [
	'HANDSHAKE_STANDARD',
	'HANDSHAKE_NO_WAIT'
];

var PROTOCOLS = ['TCP', 'UDP'];

var DEFAULTS = {
	profile: 'default',
	mtu: 1400,
	multiplexing: 'MULTIPLEXING_LOW',
	handshake_mode: 'HANDSHAKE_STANDARD',
	traffic_pattern: ''
};

function fail(error) {
	return { ok: false, error: error };
}

function isIntString(s) {
	return typeof s === 'string' && /^[0-9]+$/.test(s);
}

/* Normalize unicode dashes/spaces, validate "2012" or "2020-2030". */
function parsePortSpec(value) {
	if (typeof value !== 'string')
		return fail('port must be a string');

	var s = value.replace(/[\u2010-\u2015\u2212\s]/g, function(c) {
		return /\s/.test(c) ? '' : '-';
	});

	if (s === '')
		return fail('port is empty');

	var m = /^([0-9]+)(?:-([0-9]+))?$/.exec(s);
	if (!m)
		return fail('invalid port or port range "' + value + '"');

	var start = parseInt(m[1], 10);
	var end = m[2] !== undefined ? parseInt(m[2], 10) : start;

	if (start < 1 || start > 65535 || end < 1 || end > 65535)
		return fail('port numbers must be within 1-65535 ("' + value + '")');
	if (start > end)
		return fail('range start is greater than end ("' + value + '")');

	return {
		ok: true,
		port: m[2] !== undefined ? start + '-' + end : String(start),
		start: start,
		end: end
	};
}

function normalizeProtocol(value) {
	if (typeof value !== 'string')
		return null;
	var p = value.trim().toUpperCase();
	return PROTOCOLS.indexOf(p) !== -1 ? p : null;
}

function normalizeMultiplexing(value) {
	if (typeof value !== 'string' || value.trim() === '')
		return DEFAULTS.multiplexing;
	var v = value.trim().toUpperCase();
	if (v.indexOf('MULTIPLEXING_') !== 0)
		v = 'MULTIPLEXING_' + v;
	return MULTIPLEXING_LEVELS.indexOf(v) !== -1 ? v : null;
}

function normalizeHandshake(value) {
	if (typeof value !== 'string' || value.trim() === '')
		return DEFAULTS.handshake_mode;
	var v = value.trim().toUpperCase();
	if (v.indexOf('HANDSHAKE_') !== 0)
		v = 'HANDSHAKE_' + v;
	return HANDSHAKE_MODES.indexOf(v) !== -1 ? v : null;
}

function isBase64(s) {
	if (typeof s !== 'string' || s === '')
		return false;
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s))
		return false;
	try {
		atob(s);
		return true;
	} catch (e) {
		return false;
	}
}

/*
 * Validate a bindings array [{port, protocol}, ...].
 * Returns {errors: [...], warnings: [...]}; overlapping ranges using the
 * same protocol produce warnings (not errors), identical bindings too.
 */
function validateBindings(bindings) {
	var errors = [];
	var warnings = [];
	var specs = [];

	if (!Array.isArray(bindings) || bindings.length === 0)
		return { errors: ['at least one port binding is required'], warnings: warnings };

	for (var i = 0; i < bindings.length; i++) {
		var b = bindings[i] || {};
		var spec = parsePortSpec(b.port);
		if (!spec.ok) {
			errors.push('binding #' + (i + 1) + ': ' + spec.error);
			continue;
		}
		var proto = normalizeProtocol(b.protocol);
		if (!proto) {
			errors.push('binding #' + (i + 1) + ': invalid protocol "' + b.protocol + '" (use TCP or UDP)');
			continue;
		}
		specs.push({ idx: i, port: spec.port, start: spec.start, end: spec.end, protocol: proto });
	}

	for (var a = 0; a < specs.length; a++) {
		for (var c = a + 1; c < specs.length; c++) {
			var x = specs[a], y = specs[c];
			if (x.protocol !== y.protocol)
				continue;
			if (x.port === y.port) {
				warnings.push('bindings #' + (x.idx + 1) + ' and #' + (y.idx + 1) +
					' are identical (' + x.port + '/' + x.protocol + ')');
			} else if (x.start <= y.end && y.start <= x.end) {
				warnings.push('bindings #' + (x.idx + 1) + ' (' + x.port + ') and #' +
					(y.idx + 1) + ' (' + y.port + ') overlap on ' + x.protocol);
			}
		}
	}

	return { errors: errors, warnings: warnings };
}

/* Percent-encoding compatible with Go url.QueryEscape (space -> '+'). */
function queryEscape(s) {
	return encodeURIComponent(s)
		.replace(/%20/g, '+')
		.replace(/[!'()*]/g, function(ch) {
			return '%' + ch.charCodeAt(0).toString(16).toUpperCase();
		});
}

/* Percent-encoding for the userinfo part (space -> %20). */
function userinfoEscape(s) {
	return encodeURIComponent(s).replace(/[!'()*]/g, function(ch) {
		return '%' + ch.charCodeAt(0).toString(16).toUpperCase();
	});
}

function decodePart(s) {
	try {
		return decodeURIComponent(String(s).replace(/\+/g, ' '));
	} catch (e) {
		return String(s);
	}
}

function isIPv6(host) {
	return host.indexOf(':') !== -1;
}

function splitHostPort(authority) {
	if (authority.charAt(0) === '[') {
		var close = authority.indexOf(']');
		if (close === -1)
			return fail('unterminated IPv6 bracket in URL host');
		var host6 = authority.substring(1, close);
		var rest = authority.substring(close + 1);
		if (rest !== '' && rest.charAt(0) !== ':')
			return fail('unexpected characters after IPv6 address');
		if (!/^[0-9a-fA-F:]+$/.test(host6))
			return fail('invalid IPv6 address "' + host6 + '"');
		return { ok: true, host: host6, port: rest !== '' ? rest.substring(1) : null };
	}

	var colon = authority.indexOf(':');
	if (colon !== -1) {
		return {
			ok: true,
			host: authority.substring(0, colon),
			port: authority.substring(colon + 1)
		};
	}
	return { ok: true, host: authority, port: null };
}

/*
 * Parse a mierus:// share link.
 * Returns {ok: true, config, warnings, remark} or {ok: false, error}.
 * For standard mieru:// links returns {ok: false, standard: true, error}
 * (they carry a protobuf payload and must be decoded by the client binary).
 */
function parseLink(text) {
	if (typeof text !== 'string')
		return fail('no URL provided');

	var url = text.trim();
	if ((url.charAt(0) === '"' && url.charAt(url.length - 1) === '"') ||
	    (url.charAt(0) === "'" && url.charAt(url.length - 1) === "'"))
		url = url.substring(1, url.length - 1).trim();

	var remark = '';
	var hash = url.indexOf('#');
	if (hash !== -1) {
		remark = decodePart(url.substring(hash + 1).trim());
		url = url.substring(0, hash).trim();
	}

	if (url === '')
		return fail('no URL provided');

	if (/^mieru:\/\//i.test(url))
		return { ok: false, standard: true,
			error: 'standard mieru:// links carry a protobuf payload; decode them with the client binary (mieru explain config)' };

	if (!/^mierus:\/\//i.test(url))
		return fail('unsupported URL scheme (expected mierus://)');

	var body = url.substring('mierus://'.length);
	var qmark = body.indexOf('?');
	var authority = (qmark !== -1 ? body.substring(0, qmark) : body).replace(/\/+$/, '');
	var query = qmark !== -1 ? body.substring(qmark + 1) : '';

	var at = authority.lastIndexOf('@');
	if (at === -1)
		return fail('URL has no user info (expected mierus://user:password@host?...)');

	var auth = authority.substring(0, at);
	var hostPart = authority.substring(at + 1);
	var colon = auth.indexOf(':');
	var username = decodePart(colon !== -1 ? auth.substring(0, colon) : auth);
	var password = colon !== -1 ? decodePart(auth.substring(colon + 1)) : '';

	if (username === '')
		return fail('URL has no user name');
	if (password === '')
		return fail('URL has no password');

	var hp = splitHostPort(hostPart);
	if (!hp.ok)
		return hp;
	if (hp.host === '')
		return fail('URL has no host');

	var ports = [];
	var protocols = [];
	var singles = {};
	var pairs = query.split('&');
	for (var i = 0; i < pairs.length; i++) {
		if (pairs[i] === '')
			continue;
		var eq = pairs[i].indexOf('=');
		var key = decodePart(eq !== -1 ? pairs[i].substring(0, eq) : pairs[i]).trim();
		var val = eq !== -1 ? decodePart(pairs[i].substring(eq + 1)) : '';
		if (key === 'port')
			ports.push(val);
		else if (key === 'protocol')
			protocols.push(val);
		else if (!(key in singles))
			singles[key] = val;
	}

	var bindings = [];
	var warnings = [];
	var compact = ports.some(function(p) { return p.indexOf(',') !== -1 || p.indexOf('/') !== -1; });

	if (compact) {
		if (protocols.length > 1)
			return fail('a compact port list cannot be combined with multiple protocol parameters');
		var defProto = protocols.length === 1 ? normalizeProtocol(protocols[0]) : 'TCP';
		if (!defProto)
			return fail('invalid protocol "' + protocols[0] + '" (use TCP or UDP)');

		for (var pi = 0; pi < ports.length; pi++) {
			var elems = ports[pi].split(',');
			for (var ei = 0; ei < elems.length; ei++) {
				var elem = elems[ei].trim();
				if (elem === '')
					return fail('empty element in compact port list');
				var em = /^([0-9\u2010-\u2015\u2212-]+)(?:\/([A-Za-z]+))?$/.exec(elem);
				if (!em)
					return fail('invalid compact port element "' + elem + '"');
				var spec = parsePortSpec(em[1]);
				if (!spec.ok)
					return fail(spec.error);
				var proto = em[2] !== undefined ? normalizeProtocol(em[2]) : defProto;
				if (!proto)
					return fail('invalid protocol suffix in "' + elem + '" (use /TCP or /UDP)');
				bindings.push({ port: spec.port, protocol: proto });
			}
		}
	} else if (ports.length === 0) {
		if (hp.port !== null && hp.port !== '') {
			var aspec = parsePortSpec(hp.port);
			if (!aspec.ok)
				return fail(aspec.error);
			if (aspec.port.indexOf('-') !== -1)
				return fail('a port range in the URL authority is not supported; use port= parameters');
			var aproto = protocols.length > 0 ? normalizeProtocol(protocols[0]) : 'TCP';
			if (!aproto)
				return fail('invalid protocol "' + protocols[0] + '" (use TCP or UDP)');
			if (protocols.length > 1)
				return fail('mismatched number of port and protocol parameters');
			bindings.push({ port: aspec.port, protocol: aproto });
			warnings.push('port taken from the URL authority; prefer port= parameters');
		} else {
			return fail('URL has no port (use port= parameters)');
		}
	} else {
		if (protocols.length === 0) {
			warnings.push('no protocol parameters; defaulting every binding to TCP');
			for (var di = 0; di < ports.length; di++)
				protocols.push('TCP');
		}
		if (ports.length !== protocols.length)
			return fail('mismatched number of port and protocol parameters (' +
				ports.length + ' vs ' + protocols.length + ')');

		for (var bi = 0; bi < ports.length; bi++) {
			var bspec = parsePortSpec(ports[bi]);
			if (!bspec.ok)
				return fail(bspec.error);
			var bproto = normalizeProtocol(protocols[bi]);
			if (!bproto)
				return fail('invalid protocol "' + protocols[bi] + '" (use TCP or UDP)');
			bindings.push({ port: bspec.port, protocol: bproto });
		}
	}

	var profile = (singles.profile !== undefined && singles.profile.trim() !== '')
		? singles.profile.trim() : DEFAULTS.profile;

	var mtu = DEFAULTS.mtu;
	if (singles.mtu !== undefined && singles.mtu !== '') {
		if (!isIntString(singles.mtu.trim()))
			return fail('invalid MTU "' + singles.mtu + '"');
		mtu = parseInt(singles.mtu.trim(), 10);
		if (mtu < 1280 || mtu > 1400)
			return fail('MTU must be within 1280-1400');
	}

	var multiplexing = normalizeMultiplexing(singles.multiplexing);
	if (!multiplexing)
		return fail('invalid multiplexing level "' + singles.multiplexing + '"');

	var handshake = normalizeHandshake(singles['handshake-mode']);
	if (!handshake)
		return fail('invalid handshake mode "' + singles['handshake-mode'] + '"');

	var trafficPattern = '';
	if (singles['traffic-pattern'] !== undefined && singles['traffic-pattern'] !== '') {
		trafficPattern = singles['traffic-pattern'].trim();
		if (!isBase64(trafficPattern))
			return fail('traffic-pattern is not valid base64');
	}

	var v = validateBindings(bindings);
	if (v.errors.length > 0)
		return fail(v.errors[0]);
	warnings = warnings.concat(v.warnings);

	return {
		ok: true,
		config: {
			server_addr: hp.host,
			username: username,
			password: password,
			profile: profile,
			mtu: mtu,
			multiplexing: multiplexing,
			handshake_mode: handshake,
			traffic_pattern: trafficPattern,
			bindings: bindings
		},
		warnings: warnings,
		remark: remark
	};
}

/*
 * Generate a canonical upstream-compatible mierus:// link.
 * Throws Error when the configuration is incomplete/invalid.
 */
function generateLink(config) {
	if (!config || typeof config !== 'object')
		throw new Error('no configuration provided');
	if (!config.server_addr)
		throw new Error('server address is not set');
	if (!config.username)
		throw new Error('username is not set');
	if (!config.password)
		throw new Error('password is not set');

	var bindings = config.bindings || [];
	var v = validateBindings(bindings);
	if (v.errors.length > 0)
		throw new Error(v.errors[0]);

	var profile = config.profile || DEFAULTS.profile;
	var mtu = config.mtu !== undefined ? config.mtu : DEFAULTS.mtu;
	var multiplexing = normalizeMultiplexing(config.multiplexing);
	var handshake = normalizeHandshake(config.handshake_mode);
	if (!multiplexing)
		throw new Error('invalid multiplexing level');
	if (!handshake)
		throw new Error('invalid handshake mode');
	if (!isIntString(String(mtu)) || mtu < 1280 || mtu > 1400)
		throw new Error('MTU must be within 1280-1400');

	var host = isIPv6(config.server_addr)
		? '[' + config.server_addr + ']'
		: config.server_addr;

	var parts = [];
	parts.push('handshake-mode=' + queryEscape(handshake));
	parts.push('mtu=' + queryEscape(String(mtu)));
	parts.push('multiplexing=' + queryEscape(multiplexing));
	for (var i = 0; i < bindings.length; i++)
		parts.push('port=' + queryEscape(bindings[i].port));
	parts.push('profile=' + queryEscape(profile));
	for (var j = 0; j < bindings.length; j++)
		parts.push('protocol=' + queryEscape(normalizeProtocol(bindings[j].protocol)));
	if (config.traffic_pattern) {
		if (!isBase64(config.traffic_pattern))
			throw new Error('traffic_pattern is not valid base64');
		parts.push('traffic-pattern=' + queryEscape(config.traffic_pattern));
	}

	return 'mierus://' + userinfoEscape(config.username) + ':' +
		userinfoEscape(config.password) + '@' + host + '?' + parts.join('&');
}

function serverAddressFields(addr) {
	if (isIPv6(addr))
		return { ipAddress: addr };
	if (/^[0-9.]+$/.test(addr))
		return { ipAddress: addr };
	return { domainName: addr };
}

function bindingsToJson(bindings) {
	var out = [];
	for (var i = 0; i < bindings.length; i++) {
		var b = bindings[i];
		var spec = parsePortSpec(b.port);
		if (!spec.ok)
			throw new Error(spec.error);
		var entry = {};
		if (spec.port.indexOf('-') !== -1)
			entry.portRange = spec.port;
		else
			entry.port = spec.start;
		entry.protocol = normalizeProtocol(b.protocol) || 'TCP';
		out.push(entry);
	}
	return out;
}

/*
 * Parse an upstream mieru client JSON config (profiles[]).
 * Returns {ok, config, local, warnings} or {ok: false, error}.
 * A trafficPattern object cannot be re-encoded to protobuf in JS; it is
 * dropped with a warning (use a mierus:// link to keep it losslessly).
 */
function parseClientJson(text) {
	if (typeof text !== 'string' || text.trim() === '')
		return fail('no JSON provided');

	var obj;
	try {
		obj = JSON.parse(text.trim());
	} catch (e) {
		return fail('invalid JSON syntax');
	}
	if (!obj || typeof obj !== 'object')
		return fail('JSON is not an object');

	var profiles = obj.profiles;
	if (!Array.isArray(profiles) || profiles.length === 0)
		return fail('no profiles found in JSON (expected a mieru client config)');

	var prof = profiles[0];
	if (typeof obj.activeProfile === 'string') {
		for (var i = 0; i < profiles.length; i++) {
			if (profiles[i] && profiles[i].profileName === obj.activeProfile) {
				prof = profiles[i];
				break;
			}
		}
	}
	if (!prof || typeof prof !== 'object')
		return fail('active profile is invalid');

	var user = prof.user || {};
	if (!user.name || !user.password)
		return fail('profile has no user name or password');

	var servers = prof.servers;
	if (!Array.isArray(servers) || servers.length === 0)
		return fail('profile has no servers');
	var srv = servers[0] || {};
	var addr = srv.ipAddress || srv.domainName;
	if (!addr)
		return fail('server has no ipAddress or domainName');

	var pbs = srv.portBindings;
	if (!Array.isArray(pbs) || pbs.length === 0)
		return fail('server has no portBindings');

	var bindings = [];
	for (var j = 0; j < pbs.length; j++) {
		var pb = pbs[j] || {};
		var portStr = pb.portRange !== undefined && pb.portRange !== ''
			? String(pb.portRange)
			: (pb.port !== undefined ? String(pb.port) : '');
		var spec = parsePortSpec(portStr);
		if (!spec.ok)
			return fail('portBindings[' + j + ']: ' + spec.error);
		var proto = normalizeProtocol(pb.protocol !== undefined ? pb.protocol : 'TCP');
		if (!proto)
			return fail('portBindings[' + j + ']: invalid protocol');
		bindings.push({ port: spec.port, protocol: proto });
	}

	var mtu = prof.mtu !== undefined ? prof.mtu : DEFAULTS.mtu;
	if (typeof mtu !== 'number' || mtu < 1280 || mtu > 1400)
		return fail('MTU must be within 1280-1400');

	var multiplexing = normalizeMultiplexing(
		prof.multiplexing && prof.multiplexing.level !== undefined ? prof.multiplexing.level : '');
	if (!multiplexing)
		return fail('invalid multiplexing level in JSON');

	var handshake = normalizeHandshake(
		prof.handshakeMode !== undefined ? prof.handshakeMode : '');
	if (!handshake)
		return fail('invalid handshakeMode in JSON');

	var warnings = [];
	if (prof.trafficPattern)
		warnings.push('trafficPattern object was dropped; import a mierus:// link (or use "mieru import config") to keep it');
	if (servers.length > 1)
		warnings.push('only the first server was imported (' + servers.length + ' servers in JSON)');

	var v = validateBindings(bindings);
	if (v.errors.length > 0)
		return fail(v.errors[0]);

	return {
		ok: true,
		config: {
			server_addr: addr,
			username: String(user.name),
			password: String(user.password),
			profile: prof.profileName || DEFAULTS.profile,
			mtu: mtu,
			multiplexing: multiplexing,
			handshake_mode: handshake,
			traffic_pattern: '',
			bindings: bindings
		},
		local: {
			socks5_port: obj.socks5Port,
			socks5_listen_lan: obj.socks5ListenLAN,
			rpc_port: obj.rpcPort,
			http_proxy_port: obj.httpProxyPort,
			http_proxy_listen_lan: obj.httpProxyListenLAN,
			log_level: obj.loggingLevel
		},
		warnings: warnings.concat(v.warnings)
	};
}

/*
 * Build a full upstream client config JSON object from our config shape
 * plus local settings. Mirrors what the procd init script generates.
 * traffic_pattern cannot be represented here (protobuf) and is omitted.
 */
function generateClientJson(config, local) {
	local = local || {};
	var v = validateBindings(config.bindings || []);
	if (v.errors.length > 0)
		throw new Error(v.errors[0]);

	var profile = config.profile || DEFAULTS.profile;
	var server = serverAddressFields(config.server_addr);
	server.portBindings = bindingsToJson(config.bindings);

	var profileObj = {
		profileName: profile,
		user: { name: config.username, password: config.password },
		servers: [server],
		mtu: config.mtu !== undefined ? config.mtu : DEFAULTS.mtu,
		multiplexing: { level: normalizeMultiplexing(config.multiplexing) || DEFAULTS.multiplexing },
		handshakeMode: normalizeHandshake(config.handshake_mode) || DEFAULTS.handshake_mode
	};

	var out = {
		profiles: [profileObj],
		activeProfile: profile,
		rpcPort: local.rpc_port !== undefined && local.rpc_port !== '' ? +local.rpc_port : 8964,
		socks5Port: local.socks5_port !== undefined && local.socks5_port !== '' ? +local.socks5_port : 1080,
		loggingLevel: local.log_level || 'ERROR',
		socks5ListenLAN: local.socks5_listen_lan === undefined ? true : !!local.socks5_listen_lan
	};
	if (local.http_proxy_port !== undefined && local.http_proxy_port !== '') {
		out.httpProxyPort = +local.http_proxy_port;
		out.httpProxyListenLAN = !!local.http_proxy_listen_lan;
	}
	return out;
}

/* UCI mapping: main options + ordered port_binding sections <-> config. */
function configFromUci(main, bindingSections) {
	main = main || {};
	var bindings = [{
		port: main.port !== undefined ? String(main.port) : '',
		protocol: main.protocol || 'TCP'
	}];
	var sections = bindingSections || [];
	for (var i = 0; i < sections.length; i++) {
		bindings.push({
			port: sections[i].port !== undefined ? String(sections[i].port) : '',
			protocol: sections[i].protocol || 'TCP'
		});
	}
	return {
		server_addr: main.server_addr || '',
		username: main.username || '',
		password: main.password || '',
		profile: main.profile || DEFAULTS.profile,
		mtu: main.mtu !== undefined && main.mtu !== '' ? parseInt(main.mtu, 10) : DEFAULTS.mtu,
		multiplexing: main.multiplexing || DEFAULTS.multiplexing,
		handshake_mode: main.handshake_mode || DEFAULTS.handshake_mode,
		traffic_pattern: main.traffic_pattern || '',
		bindings: bindings
	};
}

function configToUci(config) {
	var bindings = config.bindings || [];
	if (bindings.length === 0)
		throw new Error('at least one port binding is required');
	var first = bindings[0];
	var rest = [];
	for (var i = 1; i < bindings.length; i++)
		rest.push({ port: bindings[i].port, protocol: bindings[i].protocol });
	return {
		main: {
			server_addr: config.server_addr,
			username: config.username,
			password: config.password,
			profile: config.profile || DEFAULTS.profile,
			port: first.port,
			protocol: first.protocol,
			mtu: String(config.mtu !== undefined ? config.mtu : DEFAULTS.mtu),
			multiplexing: config.multiplexing || DEFAULTS.multiplexing,
			handshake_mode: config.handshake_mode || DEFAULTS.handshake_mode,
			traffic_pattern: config.traffic_pattern || ''
		},
		bindings: rest
	};
}

/* baseclass.extend() yields a constructor: the LuCI loader does
 * `new MieruLink()` and passes the instance to requiring modules. */
var MieruLink = baseclass.extend({
	DEFAULTS: DEFAULTS,
	MULTIPLEXING_LEVELS: MULTIPLEXING_LEVELS,
	HANDSHAKE_MODES: HANDSHAKE_MODES,
	PROTOCOLS: PROTOCOLS,
	parsePortSpec: parsePortSpec,
	validateBindings: validateBindings,
	parseLink: parseLink,
	generateLink: generateLink,
	parseClientJson: parseClientJson,
	generateClientJson: generateClientJson,
	configFromUci: configFromUci,
	configToUci: configToUci
});

if (typeof module !== 'undefined' && module.exports)
	module.exports = MieruLink;

return MieruLink;