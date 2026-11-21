'use strict';
/*
 * Status panel for luci-app-mieru (on-demand, no background monitor).
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

'require baseclass';
'require rpc';
'require poll';
'require ui';

const callStatus = rpc.declare({ object: 'luci.mieru', method: 'getStatus', expect: {} });
const callVersion = rpc.declare({ object: 'luci.mieru', method: 'getVersion', expect: {} });
const callLog = rpc.declare({ object: 'luci.mieru', method: 'getLog', expect: {} });
const callTest = rpc.declare({ object: 'luci.mieru', method: 'testConnection', expect: {} });
const callAction = rpc.declare({
	object: 'luci.mieru',
	method: 'serviceAction',
	params: ['action'],
	expect: {}
});

function fmtBytes(n) {
	if (typeof n !== 'number' || n < 0)
		return '—';
	const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
	let i = 0;
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i++;
	}
	return (i === 0 ? String(n) : n.toFixed(1)) + ' ' + units[i];
}

function fmtUptime(sec) {
	if (!sec || sec < 0)
		return '—';
	const d = Math.floor(sec / 86400);
	const h = Math.floor((sec % 86400) / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = Math.floor(sec % 60);
	return (d > 0 ? d + 'd ' : '') + h + 'h ' + m + 'm ' + s + 's';
}

function badge(text, ok) {
	return E('span', {
		'style': 'color:' + (ok ? '#2eb85c' : '#e55353') + '; font-weight:bold'
	}, text);
}

async function render() {
	const versionInfo = await callVersion().catch(() => ({}));
	const cells = {};
	let prev = null;

	function row(label, id) {
		const td = E('td', { 'class': 'td' }, '—');
		cells[id] = td;
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'style': 'width:40%' }, label),
			td
		]);
	}

	const table = E('table', { 'class': 'table' }, [
		row(_('State'), 'state'),
		row(_('Process'), 'process'),
		row(_('Client version'), 'version'),
		row(_('Autostart'), 'autostart'),
		row(_('SOCKS5 endpoint'), 'socks5'),
		row(_('Traffic (download / upload)'), 'traffic'),
		row(_('Speed (download / upload)'), 'speed'),
		row(_('Active connections'), 'conn'),
		row(_('Underlay connections'), 'underlay')
	]);

	cells.version.textContent = versionInfo.version || _('unknown');

	const logPre = E('pre', {
		'style': 'max-height:20em; overflow:auto; padding:0.5em; font-size:0.85em; white-space:pre-wrap'
	}, _('Loading log…'));

	async function refreshLog() {
		try {
			const r = await callLog();
			logPre.textContent = (r.log && r.log.trim()) ? r.log : _('No log entries yet.');
		} catch (e) {
			logPre.textContent = String(e.message || e);
		}
	}

	async function refresh() {
		let st;
		try {
			st = await callStatus();
		} catch (e) {
			return;
		}

		const p = st.process || {};
		cells.state.textContent = '';
		if (p.running)
			cells.state.appendChild(badge(_('Running'), true));
		else if (st.enabled)
			cells.state.appendChild(badge(_('Not running'), false));
		else
			cells.state.appendChild(badge(_('Disabled'), false));

		cells.process.textContent = p.running
			? 'PID ' + p.pid + ' · ' + _('uptime') + ' ' + fmtUptime(p.uptime) + ' · ' + fmtBytes(p.memory)
			: '—';
		cells.autostart.textContent = st.autostart ? _('enabled') : _('disabled');
		cells.socks5.textContent = st.socks5 || '—';

		const m = st.metrics || {};
		const traffic = m.traffic || {};
		const conn = m.connections || {};
		const underlay = m.underlay || {};
		const rx = traffic.DownloadBytes || 0;
		const tx = traffic.UploadBytes || 0;

		if (p.running) {
			cells.traffic.textContent = fmtBytes(rx) + ' / ' + fmtBytes(tx);
			cells.conn.textContent = String(conn.CurrEstablished || 0);
			cells.underlay.textContent = String(underlay.CurrEstablished || 0);

			const now = Date.now();
			if (prev && now > prev.t) {
				const dt = (now - prev.t) / 1000;
				const drx = Math.max(0, rx - prev.rx) / dt;
				const dtx = Math.max(0, tx - prev.tx) / dt;
				cells.speed.textContent = fmtBytes(drx) + '/s / ' + fmtBytes(dtx) + '/s';
			}
			prev = { t: now, rx: rx, tx: tx };
		} else {
			cells.traffic.textContent = '—';
			cells.speed.textContent = '—';
			cells.conn.textContent = '—';
			cells.underlay.textContent = '—';
			prev = null;
		}
	}

	function actionButton(label, action, cls) {
		return E('button', {
			'class': 'btn ' + cls,
			'click': async function(ev) {
				ev.target.disabled = true;
				try {
					const r = await callAction(action);
					if (r.success) {
						ui.addNotification(_('Service action'),
							E('p', {}, _('Action "%s" completed.').format(action)), 'info');
					} else {
						ui.addNotification(_('Action failed'),
							E('p', {}, _('init script returned code %d').format(r.code)), 'error');
					}
					await refresh();
				} catch (e) {
					ui.addNotification(_('Action failed'),
						E('p', {}, String(e.message || e)), 'error');
				} finally {
					ev.target.disabled = false;
				}
			}
		}, label);
	}

	const testButton = E('button', {
		'class': 'btn cbi-button-neutral',
		'click': async function(ev) {
			ev.target.disabled = true;
			try {
				const r = await callTest();
				ui.showModal(_('Connection test'), [
					E('p', {}, r.success
						? badge(_('Connection successful'), true)
						: badge(_('Connection failed'), false)),
					E('pre', { 'style': 'max-height:20em; overflow:auto; white-space:pre-wrap' },
						r.output || _('no output')),
					E('div', { 'class': 'right' },
						E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Close')))
				]);
			} catch (e) {
				ui.addNotification(_('Connection test'),
					E('p', {}, String(e.message || e)), 'error');
			} finally {
				ev.target.disabled = false;
			}
		}
	}, _('Test connection'));

	poll.add(refresh, 5);
	refresh();
	refreshLog();

	return E('div', { 'class': 'cbi-map' }, [
		E('h2', {}, _('Status')),
		E('div', { 'class': 'cbi-map-descr' },
			_('On-demand process info, upstream metrics (mieru get metrics) and syslog. Refreshes every 5 seconds; no background monitor daemon is used.')),
		table,
		E('div', { 'style': 'margin:0.5em 0' }, [
			actionButton(_('Start'), 'start', 'cbi-button-positive'),
			' ',
			actionButton(_('Stop'), 'stop', 'cbi-button-negative'),
			' ',
			actionButton(_('Restart'), 'restart', 'cbi-button-action'),
			' ',
			testButton,
			' ',
			E('button', { 'class': 'btn cbi-button-neutral', 'click': refreshLog }, _('Refresh log'))
		]),
		E('h3', {}, _('Log')),
		logPre
	]);
}

return baseclass.extend({ render });