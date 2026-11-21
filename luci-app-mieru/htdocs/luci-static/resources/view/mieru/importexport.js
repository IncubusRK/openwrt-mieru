'use strict';
/*
 * Import / Export tab for luci-app-mieru.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

'require baseclass';
'require form';
'require uci';
'require ui';
'require rpc';
'require view.mieru.mieru-link as link';

const callExplainLink = rpc.declare({
	object: 'luci.mieru',
	method: 'explainLink',
	params: ['url'],
	expect: {}
});

const MAIN_OPTIONS = [
	'server_addr', 'username', 'password', 'profile', 'port', 'protocol',
	'mtu', 'multiplexing', 'handshake_mode', 'traffic_pattern'
];

function readUciConfig() {
	const main = {};
	for (const opt of MAIN_OPTIONS)
		main[opt] = uci.get('mieru', 'main', opt);
	const sections = uci.sections('mieru', 'port_binding').map(s => ({
		port: s.port,
		protocol: s.protocol || 'TCP'
	}));
	return link.configFromUci(main, sections);
}

function readLocalOptions() {
	return {
		socks5_port: uci.get('mieru', 'main', 'socks5_port'),
		socks5_listen_lan: uci.get('mieru', 'main', 'socks5_listen_lan') != '0',
		rpc_port: uci.get('mieru', 'main', 'rpc_port'),
		http_proxy_port: uci.get('mieru', 'main', 'http_proxy_port'),
		http_proxy_listen_lan: uci.get('mieru', 'main', 'http_proxy_listen_lan') == '1',
		log_level: uci.get('mieru', 'main', 'log_level')
	};
}

async function parseInput(text) {
	const t = text.trim();
	if (/^mieru:\/\//i.test(t)) {
		const res = await callExplainLink(t);
		if (res.error)
			return { ok: false, error: res.error };
		return link.parseClientJson(JSON.stringify(res.config));
	}
	if (t.charAt(0) === '{')
		return link.parseClientJson(t);
	return link.parseLink(t);
}

function previewRows(res) {
	const c = res.config;
	const rows = [
		[_('Server address'), c.server_addr],
		[_('Username'), c.username],
		[_('Password'), '••••••••'],
		[_('Profile name'), c.profile],
		['MTU', String(c.mtu)],
		[_('Multiplexing'), c.multiplexing],
		[_('Handshake mode'), c.handshake_mode],
		[_('Traffic pattern'), c.traffic_pattern ? _('present (preserved)') : _('none')]
	];
	const table = E('table', { 'class': 'table' }, rows.map(r =>
		E('tr', {}, [E('td', { 'style': 'width:40%' }, r[0]), E('td', {}, r[1])])));

	const bl = E('table', { 'class': 'table' }, [
		E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, '#'),
			E('th', { 'class': 'th' }, _('Port / range')),
			E('th', { 'class': 'th' }, _('Protocol'))
		])
	].concat(c.bindings.map((b, i) =>
		E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, String(i + 1)),
			E('td', { 'class': 'td' }, b.port),
			E('td', { 'class': 'td' }, b.protocol)
		]))));

	return [table, E('h4', {}, _('Port bindings')), bl];
}

async function applyImport(res) {
	const u = link.configToUci(res.config);

	for (const k in u.main)
		uci.set('mieru', 'main', k, u.main[k]);
	uci.set('mieru', 'main', 'enabled', '1');

	if (res.local) {
		const l = res.local;
		if (l.socks5_port !== undefined && l.socks5_port !== null)
			uci.set('mieru', 'main', 'socks5_port', String(l.socks5_port));
		if (l.socks5_listen_lan !== undefined && l.socks5_listen_lan !== null)
			uci.set('mieru', 'main', 'socks5_listen_lan', l.socks5_listen_lan ? '1' : '0');
		if (l.rpc_port !== undefined && l.rpc_port !== null)
			uci.set('mieru', 'main', 'rpc_port', String(l.rpc_port));
		if (l.http_proxy_port !== undefined && l.http_proxy_port !== null)
			uci.set('mieru', 'main', 'http_proxy_port', String(l.http_proxy_port));
		if (l.http_proxy_listen_lan !== undefined && l.http_proxy_listen_lan !== null)
			uci.set('mieru', 'main', 'http_proxy_listen_lan', l.http_proxy_listen_lan ? '1' : '0');
		if (l.log_level)
			uci.set('mieru', 'main', 'log_level', String(l.log_level));
	}

	for (const s of uci.sections('mieru', 'port_binding'))
		uci.remove('mieru', s['.name']);

	for (const b of u.bindings) {
		const sid = await uci.add('mieru', 'port_binding');
		uci.set('mieru', sid, 'port', b.port);
		uci.set('mieru', sid, 'protocol', b.protocol);
	}

	await uci.save();
	await uci.apply();
	window.location.reload();
}

function showPreview(res) {
	const warnings = (res.warnings || []).map(w => E('p', { 'class': 'alert-message warning' }, w));
	ui.showModal(_('Import preview'), [
		E('p', {}, _('The following configuration was parsed. Applying it replaces the current settings and enables the service.')),
		...previewRows(res),
		...warnings,
		E('div', { 'class': 'right' }, [
			E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')),
			' ',
			E('button', {
				'class': 'btn cbi-button-positive',
				'click': async function() {
					ui.hideModal();
					try {
						await applyImport(res);
					} catch (e) {
						ui.addNotification(_('Import failed'),
							E('p', {}, String(e.message || e)), 'error');
					}
				}
			}, _('Apply'))
		])
	]);
}

function renderImport() {
	const ta = E('textarea', {
		'style': 'width:100%; height:6em; font-family:monospace',
		'placeholder': 'mierus://user:password@server?port=2012&port=2020-2030&protocol=TCP&protocol=UDP&profile=default'
	});

	return E('div', {}, [
		E('p', {}, _('Paste a mierus:// share link (canonical or compact port=2012,2020-2030/UDP form), a standard mieru:// link (decoded by the client binary), or a mieru client JSON config. Multi-port links are imported losslessly into UCI port bindings.')),
		ta,
		E('div', { 'style': 'margin-top:0.5em' }, [
			E('button', {
				'class': 'btn cbi-button-action',
				'click': async function(ev) {
					ev.target.disabled = true;
					try {
						const res = await parseInput(ta.value);
						if (!res.ok) {
							ui.addNotification(_('Import failed'),
								E('p', {}, res.error), 'error');
						} else {
							showPreview(res);
						}
					} catch (e) {
						ui.addNotification(_('Import failed'),
							E('p', {}, String(e.message || e)), 'error');
					} finally {
						ev.target.disabled = false;
					}
				}
			}, _('Import'))
		])
	]);
}

function copyText(text) {
	if (navigator.clipboard && navigator.clipboard.writeText) {
		return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
	}
	return Promise.resolve(false);
}

function renderExport() {
	const ta = E('textarea', {
		'readonly': true,
		'style': 'width:100%; height:6em; font-family:monospace'
	});

	const genLink = function() {
		try {
			ta.value = link.generateLink(readUciConfig());
		} catch (e) {
			ui.addNotification(_('Export failed'), E('p', {}, String(e.message || e)), 'error');
		}
	};

	const genJson = function() {
		try {
			const cfg = readUciConfig();
			ta.value = JSON.stringify(link.generateClientJson(cfg, readLocalOptions()), null, 2);
			if (cfg.traffic_pattern)
				ui.addNotification(_('Traffic pattern omitted'),
					E('p', {}, _('The JSON config cannot carry the protobuf traffic pattern; use the share link export to keep it.')), 'warning');
		} catch (e) {
			ui.addNotification(_('Export failed'), E('p', {}, String(e.message || e)), 'error');
		}
	};

	return E('div', {}, [
		E('p', {}, _('Exports the saved configuration (press Save first if you changed fields). The link uses the upstream-compatible format accepted by "mieru import config".')),
		E('div', {}, [
			E('button', { 'class': 'btn cbi-button-action', 'click': genLink }, _('Generate link')),
			' ',
			E('button', { 'class': 'btn cbi-button-neutral', 'click': genJson }, _('Generate JSON')),
			' ',
			E('button', {
				'class': 'btn cbi-button-neutral',
				'click': async function() {
					if (!ta.value)
						return;
					const ok = await copyText(ta.value);
					if (ok) {
						ui.addNotification(_('Copied'), E('p', {}, _('Copied to clipboard.')), 'info');
					} else {
						ta.focus();
						ta.select();
						ui.addNotification(_('Copy manually'), E('p', {}, _('Clipboard access is unavailable; the text is selected, press Ctrl+C.')), 'warning');
					}
				}
			}, _('Copy')),
			' ',
			E('button', {
				'class': 'btn cbi-button-neutral',
				'click': function() {
					if (!ta.value)
						return;
					const blob = new Blob([ta.value], { 'type': 'text/plain' });
					const a = E('a', {
						'href': URL.createObjectURL(blob),
						'download': 'mieru-export.txt',
						'style': 'display:none'
					});
					document.body.appendChild(a);
					a.click();
					document.body.removeChild(a);
				}
			}, _('Download'))
		]),
		E('div', { 'style': 'margin-top:0.5em' }, ta)
	]);
}

function createOptions(s) {
	let o = s.option(form.DummyValue, '_import', _('Import'));
	o.render = renderImport;

	o = s.option(form.DummyValue, '_export', _('Export'));
	o.render = renderExport;
}

return baseclass.extend({ createOptions });