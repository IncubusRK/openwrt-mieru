'use strict';
/*
 * luci-app-mieru entry view: Settings / Port Bindings / Import-Export tabs
 * plus an on-demand Status panel.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

'require view';
'require form';
'require view.mieru.settings as settings';
'require view.mieru.bindings as bindings';
'require view.mieru.importexport as importexport';
'require view.mieru.status as status';

return view.extend({
	async render() {
		const map = new form.Map('mieru', _('Mieru'),
			_('Mieru proxy client (upstream enfein/mieru). Provides a local SOCKS5 proxy that can be used as an upstream in Podkop, Xray or OpenClash.'));
		map.tabbed = true;

		const s = map.section(form.TypedSection, 'mieru', _('Settings'));
		s.anonymous = true;
		s.addremove = false;
		s.cfgsections = () => ['main'];
		settings.createOptions(s);

		const b = map.section(form.GridSection, 'port_binding', _('Port Bindings'));
		b.anonymous = true;
		b.addremove = true;
		b.sortable = true;
		b.modaltitle = _('Port Binding');
		bindings.createOptions(b);

		const ie = map.section(form.TypedSection, 'importexport', _('Import / Export'));
		ie.anonymous = true;
		ie.addremove = false;
		ie.cfgsections = () => ['importexport'];
		importexport.createOptions(ie);

		const rendered = await map.render();
		const statusPanel = await status.render();

		return E('div', {}, [rendered, statusPanel]);
	}
});