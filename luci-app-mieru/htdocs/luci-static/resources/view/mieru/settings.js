'use strict';
/*
 * Settings tab for luci-app-mieru.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

'require baseclass';
'require form';
'require uci';
'require view.mieru.mieru-link as link';

function portValidate(section_id, value) {
	if (value === '')
		return true;
	const spec = link.parsePortSpec(value);
	return spec.ok ? true : spec.error;
}

function localPortValidate(section_id, value) {
	if (value === '')
		return true;
	if (!/^[0-9]+$/.test(value))
		return _('Port must be a number');
	const n = +value;
	if (n < 1 || n > 65535)
		return _('Port must be within 1-65535');
	return true;
}

function createOptions(s) {
	let o = s.option(form.Flag, 'enabled', _('Enable'),
		_('Start the mieru client and keep it running under procd.'));
	o.default = '0';
	o.rmempty = false;

	o = s.option(form.Value, 'server_addr', _('Server address'),
		_('IPv4/IPv6 address or domain name of the mita proxy server.'));
	o.rmempty = false;
	o.validate = function(section_id, value) {
		if (value === '')
			return true;
		if (/\s/.test(value) || /:\/\//.test(value))
			return _('Enter a bare IP address or domain name, without scheme or spaces');
		return true;
	};

	o = s.option(form.Value, 'port', _('Port'),
		_('Primary server port: a single port (2012) or a range (2020-2030). Add more bindings on the Port Bindings tab.'));
	o.default = '2012';
	o.rmempty = false;
	o.validate = portValidate;

	o = s.option(form.ListValue, 'protocol', _('Protocol'),
		_('Transport protocol of the primary port binding.'));
	o.value('TCP', 'TCP');
	o.value('UDP', 'UDP');
	o.default = 'TCP';
	o.rmempty = false;

	o = s.option(form.Value, 'username', _('Username'),
		_('Must match the user configured on the mita server.'));
	o.rmempty = false;

	o = s.option(form.Value, 'password', _('Password'),
		_('Must match the password configured on the mita server.'));
	o.password = true;
	o.rmempty = false;

	o = s.option(form.Value, 'profile', _('Profile name'),
		_('Client profile name used in share links and the client config.'));
	o.default = 'default';
	o.rmempty = false;
	o.validate = function(section_id, value) {
		return (value !== '' && !/\s/.test(value)) ? true : _('Profile name must not be empty or contain spaces');
	};

	o = s.option(form.DummyValue, '_socks5_hint');
	o.render = function() {
		const port = uci.get('mieru', 'main', 'socks5_port') || '1080';
		return E('div', { 'class': 'alert-message info' }, [
			E('strong', _('SOCKS5 upstream: ')),
			_('Configure %s as a SOCKS5 upstream in Podkop, Xray or OpenClash to route their traffic through mieru.').format('127.0.0.1:' + port)
		]);
	};

	o = s.option(form.Value, 'socks5_port', _('SOCKS5 port'),
		_('Local SOCKS5 proxy port (no authentication by default).'));
	o.default = '1080';
	o.rmempty = false;
	o.validate = localPortValidate;

	o = s.option(form.Flag, 'socks5_listen_lan', _('SOCKS5 listen on LAN'),
		_('Allow devices on the LAN to use this SOCKS5 proxy. Local consumers (Podkop/Xray on this router) work either way.'));
	o.default = '1';
	o.rmempty = false;

	o = s.option(form.Value, 'http_proxy_port', _('HTTP proxy port'),
		_('Optional local HTTP/HTTPS proxy port. Leave empty to disable.'));
	o.default = '';
	o.validate = localPortValidate;

	o = s.option(form.Flag, 'http_proxy_listen_lan', _('HTTP proxy listen on LAN'),
		_('Allow devices on the LAN to use the HTTP/HTTPS proxy.'));
	o.default = '0';
	o.rmempty = false;

	o = s.option(form.Value, 'rpc_port', _('RPC port'),
		_('Local control port used for status and metrics. Must differ from the SOCKS5 and HTTP proxy ports.'));
	o.default = '8964';
	o.rmempty = false;
	o.validate = localPortValidate;

	o = s.option(form.Value, 'mtu', _('MTU'),
		_('Tunnel MTU, 1280-1400. Must match the server setting.'));
	o.default = '1400';
	o.rmempty = false;
	o.validate = function(section_id, value) {
		if (!/^[0-9]+$/.test(value))
			return _('MTU must be a number');
		const n = +value;
		return (n >= 1280 && n <= 1400) ? true : _('MTU must be within 1280-1400');
	};

	o = s.option(form.ListValue, 'multiplexing', _('Multiplexing'),
		_('Connection multiplexing level.'));
	for (const level of link.MULTIPLEXING_LEVELS)
		o.value(level, level.replace('MULTIPLEXING_', ''));
	o.default = 'MULTIPLEXING_LOW';
	o.rmempty = false;

	o = s.option(form.ListValue, 'handshake_mode', _('Handshake mode'),
		_('HANDSHAKE_NO_WAIT enables 0-RTT handshakes.'));
	for (const mode of link.HANDSHAKE_MODES)
		o.value(mode, mode.replace('HANDSHAKE_', ''));
	o.default = 'HANDSHAKE_STANDARD';
	o.rmempty = false;

	o = s.option(form.ListValue, 'log_level', _('Log level'),
		_('ERROR is recommended on OpenWrt to avoid filling the log.'));
	o.value('ERROR', 'ERROR');
	o.value('WARN', 'WARN');
	o.value('INFO', 'INFO');
	o.value('DEBUG', 'DEBUG');
	o.default = 'ERROR';
	o.rmempty = false;

	o = s.option(form.Value, 'traffic_pattern', _('Traffic pattern (advanced)'),
		_('Opaque base64 protobuf payload from a mierus:// share link. Preserved in exports; applied through the client binary when the service starts. Leave empty unless your server requires it.'));
	o.default = '';
	o.validate = function(section_id, value) {
		if (value === '')
			return true;
		return /^[A-Za-z0-9+/]+={0,2}$/.test(value) ? true : _('Traffic pattern must be base64 (copied from a share link)');
	};
}

return baseclass.extend({ createOptions });