'use strict';
/*
 * Port Bindings tab for luci-app-mieru (multi-port / ranges).
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

'require baseclass';
'require form';
'require uci';
'require ui';
'require view.mieru.mieru-link as link';

function currentBindings() {
	const main = {
		port: uci.get('mieru', 'main', 'port'),
		protocol: uci.get('mieru', 'main', 'protocol') || 'TCP'
	};
	const bindings = [main];
	for (const s of uci.sections('mieru', 'port_binding'))
		bindings.push({ port: s.port, protocol: s.protocol || 'TCP' });
	return bindings;
}

function createOptions(s) {
	s.description = _('Additional server port bindings. The primary binding is configured on the Settings tab; each row here adds one more port or port range with its own protocol. Mieru picks a random binding for every new connection.');

	let o = s.option(form.Value, 'port', _('Port / range'),
		_('Single port (2012) or range (2020-2030).'));
	o.width = '50%';
	o.editable = true;
	o.rmempty = false;
	o.validate = function(section_id, value) {
		const spec = link.parsePortSpec(value);
		return spec.ok ? true : spec.error;
	};

	o = s.option(form.ListValue, 'protocol', _('Protocol'));
	o.value('TCP', 'TCP');
	o.value('UDP', 'UDP');
	o.default = 'TCP';
	o.width = '30%';
	o.editable = true;
	o.rmempty = false;

	o = s.option(form.DummyValue, '_overlap_check');
	o.width = '20%';
	o.editable = true;
	o.render = function() {
		return E('button', {
			'class': 'btn cbi-button-neutral',
			'click': function() {
				const v = link.validateBindings(currentBindings());
				if (v.errors.length > 0) {
					ui.addNotification(_('Invalid bindings'),
						E('div', {}, v.errors.map(e => E('p', {}, e))), 'error');
				} else if (v.warnings.length > 0) {
					ui.addNotification(_('Binding warnings'),
						E('div', {}, v.warnings.map(w => E('p', {}, w))), 'warning');
				} else {
					ui.addNotification(_('Bindings look good'),
						E('p', {}, _('No overlaps or duplicates detected.')), 'info');
				}
			}
		}, _('Check overlaps'));
	};
}

return baseclass.extend({ createOptions, currentBindings });