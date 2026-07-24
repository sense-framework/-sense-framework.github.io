(() => {
  'use strict';

  const SESSION_KEY = 'sense.demoAdminUntil';
  const SESSION_MS = 6 * 60 * 60 * 1000;
  const demoUser = Object.freeze({
    id: 'local-demo-admin',
    displayName: 'Temporary Administrator',
    username: 'admin-preview',
    email: 'admin@local.preview',
    role: 'admin',
    status: 'active'
  });

  const byId = id => document.getElementById(id);
  const all = selector => [...document.querySelectorAll(selector)];
  const isActive = () => Number(sessionStorage.getItem(SESSION_KEY) || 0) > Date.now();
  const sense = () => window.SENSE || {};

  function setText(id, value) {
    const node = byId(id);
    if (node) node.textContent = value;
  }

  function showView(name) {
    all('.view').forEach(view => view.classList.toggle('active', view.id === `view-${name}`));
    all('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === name));
    const titles = { home: 'SENSE', messages: 'Messages', people: 'People', admin: 'Administration', settings: 'System' };
    setText('viewTitle', titles[name] || 'SENSE');
    const frame = document.querySelector('.app-frame');
    if (frame) frame.scrollTop = 0;
  }

  function seedAdmin() {
    setText('adminUserCount', '4');
    const users = byId('adminUsers');
    if (users) {
      users.innerHTML = [
        ['Temporary Administrator', '@admin-preview', 'Administrator', 'Active'],
        ['Morgan Reed', '@morgan', 'User', 'Active'],
        ['Taylor Lane', '@taylor', 'User', 'Active'],
        ['System Test', '@system-test', 'User', 'Suspended']
      ].map((user, index) => `
        <div class="admin-user" data-demo-user="${index}">
          <span><strong>${user[0]}</strong><small>${user[1]} · ${user[2]} · <b data-demo-status>${user[3]}</b></small></span>
          <span class="admin-user-actions">
            <button type="button" data-demo-toggle>${user[3] === 'Active' ? 'Suspend' : 'Activate'}</button>
            <button type="button" data-demo-role>${user[2] === 'Administrator' ? 'User' : 'Admin'}</button>
          </span>
        </div>`).join('');
    }

    const audit = byId('auditList');
    if (audit) {
      audit.innerHTML = [
        ['preview.session.started', 'admin-preview', 'Now'],
        ['system.interface.loaded', 'system', 'Now'],
        ['account.role.previewed', 'admin-preview', 'Now']
      ].map(event => `<div class="audit-row"><span><strong>${event[0]}</strong><small>${event[1]} · ${event[2]}</small></span></div>`).join('');
    }
  }

  function updateChrome() {
    setText('avatarInitial', 'A');
    setText('settingsAvatar', 'A');
    setText('settingsName', demoUser.displayName);
    setText('settingsRole', 'Local administrator preview');
    setText('healthValue', 'Preview');
    setText('homeSystemStatus', 'Administrator preview');

    all('.admin-only').forEach(node => node.classList.remove('hidden'));

    const connection = byId('connectionState');
    if (connection) {
      connection.classList.remove('online', 'offline');
      connection.classList.add('offline');
      const label = connection.querySelector('span');
      if (label) label.textContent = 'Preview';
    }
  }

  function activatePreview() {
    sessionStorage.setItem(SESSION_KEY, String(Date.now() + SESSION_MS));

    const app = sense();
    if (app.state) {
      app.state.user = { ...demoUser };
      app.state.local = true;
      app.state.token = '';
    }

    const dialog = byId('authDialog');
    if (dialog?.open) dialog.close();
    byId('lockScreen')?.classList.add('hidden');
    byId('os')?.classList.remove('hidden');

    updateChrome();
    seedAdmin();
    showView('home');

    if (typeof app.toast === 'function') app.toast('Temporary administrator preview enabled');
    window.dispatchEvent(new CustomEvent('sense:demo-admin', { detail: { user: demoUser } }));
  }

  function addPreviewControl() {
    const dialog = byId('authDialog');
    if (!dialog || byId('demoAdminButton')) return;

    const section = document.createElement('div');
    section.className = 'demo-admin-preview';
    section.innerHTML = `
      <div class="demo-admin-divider"><span>PREVIEW</span></div>
      <button class="secondary-action" id="demoAdminButton" type="button">Open temporary administrator</button>
      <small>Local interface preview only. No server account or shared data is created.</small>`;
    dialog.appendChild(section);
  }

  function addStyles() {
    if (byId('demoAdminStyles')) return;
    const style = document.createElement('style');
    style.id = 'demoAdminStyles';
    style.textContent = `
      .demo-admin-preview{display:grid;gap:10px;margin-top:18px;padding-top:4px}
      .demo-admin-preview small{display:block;color:var(--muted,#8d8a88);font-size:.72rem;line-height:1.45;text-align:center}
      .demo-admin-divider{display:flex;align-items:center;gap:10px;color:var(--muted,#8d8a88);font-size:.62rem;letter-spacing:.22em}
      .demo-admin-divider:before,.demo-admin-divider:after{content:"";height:1px;flex:1;background:var(--line,rgba(255,255,255,.09))}
      #demoAdminButton{width:100%;min-height:46px;border-color:rgba(227,19,44,.42);background:rgba(227,19,44,.07)}
      #demoAdminButton:hover{background:rgba(227,19,44,.14)}
    `;
    document.head.appendChild(style);
  }

  function handleDemoActions(event) {
    if (!isActive()) return;

    const viewButton = event.target.closest('[data-view]');
    if (viewButton?.dataset.view) setTimeout(() => showView(viewButton.dataset.view), 0);

    const toggle = event.target.closest('[data-demo-toggle]');
    if (toggle) {
      const row = toggle.closest('[data-demo-user]');
      const status = row?.querySelector('[data-demo-status]');
      if (!status) return;
      const active = status.textContent.trim() === 'Active';
      status.textContent = active ? 'Suspended' : 'Active';
      toggle.textContent = active ? 'Activate' : 'Suspend';
      sense().toast?.(`Preview account ${active ? 'suspended' : 'activated'}`);
    }

    const role = event.target.closest('[data-demo-role]');
    if (role) {
      role.textContent = role.textContent.trim() === 'Admin' ? 'User' : 'Admin';
      sense().toast?.('Preview role changed');
    }
  }

  function handleBroadcast(event) {
    if (!isActive() || event.target.id !== 'broadcastForm') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const title = byId('broadcastTitle')?.value.trim();
    const body = byId('broadcastBody')?.value.trim();
    if (!title || !body) return;
    const banner = byId('systemBanner');
    if (banner) {
      banner.textContent = `${title} — ${body}`;
      banner.classList.remove('hidden');
      setTimeout(() => banner.classList.add('hidden'), 7000);
    }
    event.target.reset();
    sense().toast?.('Preview broadcast transmitted');
  }

  function boot() {
    addStyles();
    addPreviewControl();

    byId('demoAdminButton')?.addEventListener('click', activatePreview);
    document.addEventListener('click', handleDemoActions, true);
    document.addEventListener('submit', handleBroadcast, true);
    byId('logoutButton')?.addEventListener('click', () => sessionStorage.removeItem(SESSION_KEY), true);

    if (isActive()) activatePreview();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();