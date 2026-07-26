(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const TOKEN_KEY = 'sense.session.v1';
  const CART_KEY = 'sense.cart.v1';
  const API_KEY = 'sense.api';
  const ADMIN_PERMISSIONS = {
    owner: ['*'],
    admin: ['users', 'catalog', 'orders', 'memberships', 'messages', 'analytics', 'settings', 'audit', 'broadcasts'],
    support: ['users', 'orders', 'memberships', 'messages'],
    editor: ['catalog', 'settings'],
    analyst: ['analytics', 'orders', 'memberships'],
    member: []
  };
  const ADMIN_TABS = [
    ['overview', '◈', 'Overview', 'analytics'],
    ['catalog', '▦', 'Catalog', 'catalog'],
    ['orders', '⌁', 'Orders', 'orders'],
    ['memberships', '◆', 'Members', 'memberships'],
    ['users', '◎', 'Users', 'users'],
    ['chats', '✉', 'Chats', 'messages'],
    ['analytics', '⌇', 'Analytics', 'analytics'],
    ['payments', '$', 'Payments', 'settings'],
    ['theme', '◐', 'Theme', 'settings'],
    ['broadcasts', '◉', 'Broadcasts', 'broadcasts'],
    ['audit', '§', 'Audit', 'audit']
  ];

  const state = {
    token: sessionStorage.getItem(TOKEN_KEY) || '',
    user: null,
    memberships: [],
    config: null,
    products: [],
    plans: [],
    orders: [],
    cart: loadJson(CART_KEY, []),
    conversations: [],
    activeConversation: null,
    adminTab: 'overview',
    adminCache: {},
    workspaceSyncTimer: null,
    pendingEnterprise: null
  };

  function loadJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }

  function money(cents, currency = 'USD') {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(cents || 0) / 100);
  }

  function dateTime(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(value));
  }

  function apiBase() {
    return String(localStorage.getItem(API_KEY) || window.SENSE_CONFIG?.apiUrl || '').replace(/\/$/, '');
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined && !(options.body instanceof FormData)) headers['content-type'] = 'application/json';
    if (state.token && options.auth !== false) headers.authorization = `Bearer ${state.token}`;
    const response = await fetch(`${apiBase()}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined || options.body instanceof FormData ? options.body : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeout || 18_000)
    });
    const result = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result?.error || 'Request failed');
      error.status = response.status;
      error.details = result;
      throw error;
    }
    return result;
  }

  function setConnection(online) {
    const node = $('.sync');
    if (!node) return;
    node.classList.toggle('online', online);
    node.classList.toggle('offline', !online);
    const label = node.querySelector('b');
    if (label) label.textContent = online ? 'ONLINE' : 'OFFLINE';
  }

  function status(message = '', type = '') {
    const node = $('#authStatus');
    if (!node) return;
    node.textContent = message;
    node.className = `auth-status ${type}`;
  }

  function applyTheme(theme) {
    if (!theme) return;
    const root = document.documentElement;
    const values = {
      '--brand-bg': theme.background,
      '--brand-surface': theme.surface,
      '--brand-accent': theme.accent,
      '--brand-accent-strong': theme.accentStrong,
      '--brand-text': theme.text,
      '--brand-muted': theme.muted,
      '--brand-radius': `${theme.radius}px`,
      '--brand-font-scale': theme.fontScale
    };
    Object.entries(values).forEach(([key, value]) => root.style.setProperty(key, value));
  }

  async function loadConfig() {
    try {
      state.config = await api('/api/config', { auth: false });
      applyTheme(state.config.theme);
      setConnection(true);
      return state.config;
    } catch {
      state.config = {
        features: { store: true, memberships: true, registration: true },
        payments: { card: false, crypto: false }
      };
      setConnection(false);
      return state.config;
    }
  }

  function can(permission) {
    const permissions = ADMIN_PERMISSIONS[state.user?.role] || [];
    return permissions.includes('*') || permissions.includes(permission);
  }

  function canAdmin() {
    return ADMIN_TABS.some(([, , , permission]) => can(permission));
  }

  function setSession(payload) {
    state.token = payload.token;
    state.user = payload.user;
    sessionStorage.setItem(TOKEN_KEY, state.token);
    window.SENSE_SESSION = { user: state.user };
    renderIdentity();
  }

  function clearSession(reload = true) {
    state.token = '';
    state.user = null;
    state.memberships = [];
    sessionStorage.removeItem(TOKEN_KEY);
    window.SENSE_SESSION = null;
    if (reload) {
      location.hash = '';
      location.reload();
    }
  }

  function renderIdentity() {
    if (!state.user) return;
    const avatar = $('.avatar');
    if (avatar) avatar.textContent = state.user.displayName?.trim()?.[0]?.toUpperCase() || state.user.username?.[0]?.toUpperCase() || 'S';
    $('#adminRole').textContent = state.user.role;
    if ($('#profileName') && !$('#profileName').value) $('#profileName').value = state.user.displayName || '';
    const existing = $('#platformAdminLink');
    if (existing) existing.remove();
    if (canAdmin()) {
      const settingsGrid = $('#view-system .settings-grid');
      if (settingsGrid) {
        settingsGrid.insertAdjacentHTML('afterbegin', `
          <article class="glass panel link-list" id="platformAdminLink">
            <h2>Command administration</h2>
            <button class="nav-target" data-platform-view="admin">Open administration</button>
          </article>
        `);
        $('[data-platform-view="admin"]').onclick = () => window.SENSE_APP?.show?.('admin');
      }
    }
  }

  async function login() {
    status('Signing in…');
    try {
      const payload = await api('/api/auth/login', {
        method: 'POST',
        auth: false,
        body: { email: $('#email').value.trim(), password: $('#password').value }
      });
      setSession(payload);
      status('');
      await enterPlatform();
    } catch (error) {
      status(error.message, 'error');
    }
  }

  async function register() {
    status('Creating account…');
    try {
      const payload = await api('/api/auth/register', {
        method: 'POST',
        auth: false,
        body: {
          displayName: $('#registerName').value.trim(),
          username: $('#registerUsername').value.trim(),
          email: $('#registerEmail').value.trim(),
          password: $('#registerPassword').value
        }
      });
      setSession(payload);
      status('');
      await enterPlatform();
    } catch (error) {
      status(error.message, 'error');
    }
  }

  async function restoreSession() {
    if (!state.token) return false;
    try {
      const result = await api('/api/me');
      state.user = result.user;
      state.memberships = result.memberships || [];
      window.SENSE_SESSION = { user: state.user };
      renderIdentity();
      await enterPlatform(false);
      return true;
    } catch {
      clearSession(false);
      return false;
    }
  }

  async function enterPlatform(refreshMe = true) {
    if (refreshMe) {
      const account = await api('/api/me');
      state.user = account.user;
      state.memberships = account.memberships || [];
      window.SENSE_SESSION = { user: state.user };
      renderIdentity();
    }
    await Promise.allSettled([loadWorkspace(), loadCommerce()]);
    window.SENSE_APP?.open?.();
    renderMemberships();
    renderOrders();
    if (location.hash.includes('payment=success')) {
      window.SENSE_APP?.toast?.('Payment received. Status will update after verification.');
      setTimeout(() => refreshOrders(), 1600);
    }
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    clearSession(true);
  }

  async function loadWorkspace() {
    const result = await api('/api/workspace');
    if (result.workspace) window.SENSE_APP?.hydrate?.(result.workspace);
    if (result.enterprise) {
      if (window.SENSE_ENTERPRISE?.importState) window.SENSE_ENTERPRISE.importState(result.enterprise);
      else state.pendingEnterprise = result.enterprise;
    }
  }

  function scheduleWorkspaceSync() {
    if (!state.token) return;
    clearTimeout(state.workspaceSyncTimer);
    state.workspaceSyncTimer = setTimeout(async () => {
      const enterprise = window.SENSE_ENTERPRISE?.exportState?.() || loadJson('sense.enterprise.v1', {});
      try {
        await api('/api/workspace', {
          method: 'PUT',
          body: { workspace: window.SENSE_APP?.state?.() || {}, enterprise }
        });
        setConnection(true);
      } catch {
        setConnection(false);
      }
    }, 850);
  }

  async function loadCommerce() {
    const tasks = [
      api('/api/store/products', { auth: false }),
      api('/api/store/plans', { auth: false }),
      state.token ? api('/api/orders') : Promise.resolve({ orders: [] })
    ];
    const [productResult, planResult, orderResult] = await Promise.all(tasks);
    state.products = productResult.products || [];
    state.plans = planResult.plans || [];
    state.orders = orderResult.orders || [];
    sanitizeCart();
    renderCommerce();
  }

  function sanitizeCart() {
    const available = new Set(state.products.map(product => product.id));
    state.cart = state.cart.filter(item => available.has(item.productId) && item.quantity > 0);
    localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
  }

  function cartQuantity() {
    return state.cart.reduce((sum, item) => sum + item.quantity, 0);
  }

  function cartLines() {
    return state.cart.map(item => {
      const product = state.products.find(entry => entry.id === item.productId);
      return product ? { ...item, product, totalCents: product.priceCents * item.quantity } : null;
    }).filter(Boolean);
  }

  function addToCart(productId) {
    const product = state.products.find(item => item.id === productId);
    if (!product) return;
    const existing = state.cart.find(item => item.productId === productId);
    if (existing) existing.quantity += 1;
    else state.cart.push({ productId, quantity: 1 });
    persistCart();
    window.SENSE_APP?.toast?.(`${product.name} added`);
  }

  function changeCart(productId, delta) {
    const item = state.cart.find(entry => entry.productId === productId);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) state.cart = state.cart.filter(entry => entry !== item);
    persistCart();
  }

  function persistCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
    renderCart();
  }

  function productMarkup(product) {
    const inventory = product.inventory == null ? '' : product.inventory === 0
      ? '<span class="inventory-note">Sold out</span>'
      : `<span class="inventory-note">${product.inventory} available</span>`;
    return `
      <article class="glass product-card">
        <div class="product-media">${product.imageUrl ? `<img src="${esc(product.imageUrl)}" alt="">` : '<span>◈</span>'}</div>
        <header><h2>${esc(product.name)}</h2>${product.featured ? '<span class="status-pill active">Featured</span>' : ''}</header>
        <p>${esc(product.description || 'Details will be published with this product.')}</p>
        <div class="product-tags">${(product.tags || []).map(tag => `<span>${esc(tag)}</span>`).join('')}</div>
        <footer><div><strong class="product-price">${money(product.priceCents, product.currency)}</strong>${inventory}</div><button class="primary" data-cart-add="${product.id}" ${product.inventory === 0 ? 'disabled' : ''}>Add</button></footer>
      </article>
    `;
  }

  function renderProducts() {
    const root = $('#productGrid');
    if (!root) return;
    const query = ($('#storeSearch')?.value || '').trim().toLowerCase();
    const products = state.products.filter(product => `${product.name} ${product.description} ${(product.tags || []).join(' ')}`.toLowerCase().includes(query));
    root.innerHTML = products.length
      ? products.map(productMarkup).join('')
      : `<div class="empty-state"><span>◈</span><h2>${query ? 'No matching products' : 'Shop opening soon'}</h2><p>${query ? 'Try a different search.' : 'The catalog is ready for products to be published from administration.'}</p></div>`;
  }

  function checkoutButtons(kind, idValue = '') {
    const providers = state.config?.payments || {};
    const buttons = [];
    if (providers.card) buttons.push(`<button class="primary" data-checkout-kind="${kind}" data-checkout-provider="stripe" data-checkout-id="${idValue}">Pay by card</button>`);
    if (providers.crypto) buttons.push(`<button class="secondary" data-checkout-kind="${kind}" data-checkout-provider="coinbase" data-checkout-id="${idValue}">Pay with crypto</button>`);
    return buttons.length ? buttons.join('') : '<p class="payment-note">Checkout will appear when a payment provider is connected.</p>';
  }

  function renderCart() {
    const count = cartQuantity();
    if ($('#cartCount')) $('#cartCount').textContent = count;
    if ($('#homeProductCount')) $('#homeProductCount').textContent = state.products.length;
    const root = $('#cartPanel');
    if (!root) return;
    const lines = cartLines();
    const total = lines.reduce((sum, line) => sum + line.totalCents, 0);
    root.innerHTML = `
      <header><h2>Cart</h2><span class="status-pill">${count} item${count === 1 ? '' : 's'}</span></header>
      ${lines.length ? lines.map(line => `
        <div class="cart-line">
          <div><b>${esc(line.product.name)}</b><small>${money(line.product.priceCents, line.product.currency)} each</small></div>
          <div><strong>${money(line.totalCents, line.product.currency)}</strong><div class="cart-quantity"><button data-cart-change="${line.productId}" data-delta="-1" aria-label="Remove one">−</button><span>${line.quantity}</span><button data-cart-change="${line.productId}" data-delta="1" aria-label="Add one">+</button></div></div>
        </div>
      `).join('') : '<div class="admin-empty"><div><span>⌁</span><h3>Your cart is empty</h3></div></div>'}
      ${lines.length ? `<div class="cart-total"><span>Total</span><strong>${money(total, lines[0].product.currency)}</strong></div><div class="checkout-options">${checkoutButtons('order')}</div><p class="payment-note">Final payment, tax, and billing details are confirmed in secure checkout.</p>` : ''}
    `;
  }

  function renderMemberships() {
    const currentRoot = $('#currentMembership');
    const planRoot = $('#planGrid');
    if (!currentRoot || !planRoot) return;
    const active = state.memberships.filter(item => item.status === 'active');
    $('#homeMembershipCount').textContent = active.length;
    currentRoot.innerHTML = active.length ? active.map(item => `
      <article class="glass current-plan">
        <div><span class="status-pill active">Active</span><h2>${esc(item.plan?.name || 'Membership')}</h2><p>Renews or expires ${dateTime(item.currentPeriodEnd)}</p></div>
        <strong>${item.plan ? `${money(item.plan.priceCents, item.plan.currency)} / ${esc(item.plan.interval)}` : ''}</strong>
      </article>
    `).join('') : '';
    const hasStripe = active.some(item => item.provider === 'stripe');
    $('#manageBilling').classList.toggle('hidden', !hasStripe);
    planRoot.innerHTML = state.plans.length ? state.plans.map(plan => `
      <article class="glass plan-card ${plan.featured ? 'featured' : ''}">
        <header><h2>${esc(plan.name)}</h2>${plan.featured ? '<span class="status-pill active">Recommended</span>' : ''}</header>
        <strong class="plan-price">${money(plan.priceCents, plan.currency)} <small>/ ${esc(plan.interval)}</small></strong>
        <p>${esc(plan.description)}</p>
        <ul>${(plan.benefits || []).map(benefit => `<li>${esc(benefit)}</li>`).join('')}</ul>
        <footer class="plan-actions">${checkoutButtons('membership', plan.id)}</footer>
      </article>
    `).join('') : '<div class="empty-state"><span>◆</span><h2>Memberships opening soon</h2><p>Plans can be configured and published from administration.</p></div>';
  }

  function renderOrders() {
    const root = $('#orderList');
    if (!root) return;
    $('#homeOrderCount').textContent = state.orders.length;
    root.innerHTML = state.orders.length ? state.orders.map(order => `
      <article class="glass order-card">
        <div><span class="status-pill ${esc(order.status)}">${esc(order.status)}</span><h2>${esc(order.number)}</h2><p>${dateTime(order.createdAt)} · ${esc(order.paymentProvider || '')}</p></div>
        <div class="order-items">${(order.lineItems || []).map(item => `<span>${item.quantity} × ${esc(item.name)}</span>`).join('')}</div>
        <div class="order-total"><strong>${money(order.totalCents, order.currency)}</strong><small>${esc(order.fulfillmentStatus || '')}</small></div>
      </article>
    `).join('') : '<div class="empty-state"><span>⌁</span><h2>No orders</h2><p>Your purchases will appear here after checkout begins.</p></div>';
  }

  function renderCommerce() {
    renderProducts();
    renderCart();
    renderMemberships();
    renderOrders();
  }

  async function checkout(kind, provider, itemId) {
    if (!state.token) {
      $('#auth').classList.remove('hidden');
      return;
    }
    try {
      window.SENSE_APP?.toast?.('Opening secure checkout…');
      const result = kind === 'membership'
        ? await api('/api/checkout/membership', { method: 'POST', body: { provider, planId: itemId } })
        : await api('/api/checkout/order', { method: 'POST', body: { provider, items: state.cart } });
      if (result.checkoutUrl) location.assign(result.checkoutUrl);
    } catch (error) {
      window.SENSE_APP?.toast?.(error.message);
    }
  }

  async function refreshOrders() {
    if (!state.token) return;
    try {
      const [ordersResult, account] = await Promise.all([api('/api/orders'), api('/api/me')]);
      state.orders = ordersResult.orders || [];
      state.memberships = account.memberships || [];
      renderOrders();
      renderMemberships();
    } catch (error) {
      window.SENSE_APP?.toast?.(error.message);
    }
  }

  async function openBilling() {
    try {
      const result = await api('/api/billing/portal', { method: 'POST' });
      if (result.url) location.assign(result.url);
    } catch (error) {
      window.SENSE_APP?.toast?.(error.message);
    }
  }

  async function loadConversations() {
    if (!state.token) return;
    try {
      const result = await api('/api/conversations');
      state.conversations = result.conversations || [];
      renderConversations();
    } catch (error) {
      $('#conversationList').innerHTML = `<div class="empty-state"><span>✉</span><h2>${esc(error.message)}</h2></div>`;
    }
  }

  function renderConversations() {
    const root = $('#conversationList');
    if (!root) return;
    root.innerHTML = state.conversations.length ? state.conversations.map(item => `
      <button class="conversation-row ${state.activeConversation === item.user.id ? 'active' : ''}" data-platform-conversation="${item.user.id}">
        <b>${esc(item.user.displayName)}</b>
        <small>${esc(item.lastMessage?.body || item.user.username)}</small>
      </button>
    `).join('') : '<div class="empty-state"><span>✉</span><h2>No conversations</h2></div>';
    $$('[data-platform-conversation]').forEach(button => button.onclick = () => openConversation(button.dataset.platformConversation));
  }

  async function openConversation(userId) {
    const peer = state.conversations.find(item => item.user.id === userId)?.user || state.adminCache.chatPeer;
    state.activeConversation = userId;
    renderConversations();
    $('#conversationHeader').textContent = peer?.displayName || 'Conversation';
    $('#messageList').innerHTML = '<div class="empty-state"><span>✉</span><h2>Loading</h2></div>';
    try {
      const result = await api(`/api/conversations/${encodeURIComponent(userId)}/messages`);
      $('#messageList').innerHTML = result.messages.length ? result.messages.map(message => `
        <div class="message-bubble ${message.senderId === state.user.id ? 'me' : ''}">
          ${esc(message.body)}<small>${dateTime(message.createdAt)}</small>
        </div>
      `).join('') : '<div class="empty-state"><span>✉</span><h2>Start the conversation</h2></div>';
      $('#messageList').scrollTop = $('#messageList').scrollHeight;
    } catch (error) {
      $('#messageList').innerHTML = `<div class="empty-state"><span>!</span><h2>${esc(error.message)}</h2></div>`;
    }
  }

  async function sendMessage() {
    const input = $('#messageInput');
    const body = input.value.trim();
    if (!body || !state.activeConversation) return;
    input.disabled = true;
    try {
      await api(`/api/conversations/${encodeURIComponent(state.activeConversation)}/messages`, {
        method: 'POST',
        body: { body }
      });
      input.value = '';
      await Promise.all([openConversation(state.activeConversation), loadConversations()]);
    } catch (error) {
      window.SENSE_APP?.toast?.(error.message);
    } finally {
      input.disabled = false;
      input.focus();
    }
  }

  function modal(title, body) {
    closeModal();
    document.body.insertAdjacentHTML('beforeend', `
      <section class="admin-modal" id="platformModal" role="dialog" aria-modal="true">
        <div class="glass admin-modal-card"><header><h2>${esc(title)}</h2><button id="platformModalClose" aria-label="Close">×</button></header><div class="admin-modal-body">${body}</div></div>
      </section>
    `);
    $('#platformModalClose').onclick = closeModal;
    $('#platformModal').onclick = event => { if (event.target.id === 'platformModal') closeModal(); };
  }

  function closeModal() {
    $('#platformModal')?.remove();
  }

  function openNewMessage() {
    modal('New message', `
      <div class="admin-form"><label>Find a person<input type="search" id="personSearch" placeholder="Name or username" autofocus></label><div id="personResults" class="activity-list"></div></div>
    `);
    let timer;
    $('#personSearch').oninput = event => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const query = event.target.value.trim();
        if (query.length < 2) return;
        const result = await api(`/api/users?q=${encodeURIComponent(query)}`);
        $('#personResults').innerHTML = result.users.map(user => `
          <button class="activity-row" data-person-id="${user.id}" data-person-name="${esc(user.displayName)}"><span><b>${esc(user.displayName)}</b><small>@${esc(user.username)}</small></span><span>Message</span></button>
        `).join('');
        $$('[data-person-id]').forEach(button => button.onclick = () => {
          state.adminCache.chatPeer = { id: button.dataset.personId, displayName: button.dataset.personName };
          closeModal();
          window.SENSE_APP?.show?.('messages');
          openConversation(button.dataset.personId);
        });
      }, 250);
    };
  }

  function adminAllowedTabs() {
    return ADMIN_TABS.filter(([, , , permission]) => can(permission));
  }

  function renderAdminNav() {
    const root = $('#adminNav');
    if (!root) return;
    const tabs = adminAllowedTabs();
    if (!tabs.some(([idValue]) => idValue === state.adminTab)) state.adminTab = tabs[0]?.[0] || '';
    root.innerHTML = tabs.map(([idValue, icon, label]) => `
      <button class="${state.adminTab === idValue ? 'active' : ''}" data-admin-tab="${idValue}"><span><i>${icon}</i>${label}</span><b>›</b></button>
    `).join('');
    $$('[data-admin-tab]').forEach(button => button.onclick = () => loadAdminTab(button.dataset.adminTab));
  }

  function adminLoading() {
    $('#adminContent').innerHTML = '<div class="admin-empty"><div><span>◈</span><h3>Loading command data</h3></div></div>';
  }

  function adminError(error) {
    $('#adminContent').innerHTML = `<div class="admin-empty"><div><span>!</span><h3>${esc(error.message)}</h3></div></div>`;
  }

  async function loadAdminTab(tab = state.adminTab) {
    if (!canAdmin()) {
      window.SENSE_APP?.show?.('home');
      window.SENSE_APP?.toast?.('Administrator access required');
      return;
    }
    state.adminTab = tab;
    renderAdminNav();
    adminLoading();
    try {
      if (tab === 'overview') await renderAdminOverview();
      if (tab === 'catalog') await renderAdminCatalog();
      if (tab === 'orders') await renderAdminOrders();
      if (tab === 'memberships') await renderAdminMemberships();
      if (tab === 'users') await renderAdminUsers();
      if (tab === 'chats') await renderAdminChats();
      if (tab === 'analytics') await renderAdminAnalytics();
      if (tab === 'payments') await renderAdminPayments();
      if (tab === 'theme') await renderAdminTheme();
      if (tab === 'broadcasts') renderAdminBroadcasts();
      if (tab === 'audit') await renderAdminAudit();
    } catch (error) {
      adminError(error);
    }
  }

  function kpi(label, value) {
    return `<article class="glass admin-kpi"><small>${esc(label)}</small><strong>${esc(value)}</strong></article>`;
  }

  async function renderAdminOverview() {
    const result = await api('/api/admin/summary');
    state.adminCache.summary = result;
    const metrics = result.metrics;
    $('#adminContent').innerHTML = `
      <div class="admin-kpis">
        ${kpi('30-day revenue', money(metrics.revenue30dCents))}
        ${kpi('Paid orders', metrics.paidOrders30d)}
        ${kpi('Active members', metrics.activeMembers)}
        ${kpi('Users', metrics.users)}
        ${kpi('Active products', metrics.activeProducts)}
        ${kpi('Pending orders', metrics.pendingOrders)}
        ${kpi('Messages · 30d', metrics.messages30d)}
      </div>
      <div class="admin-grid-2">
        <article class="glass admin-panel"><header><h2>Recent system activity</h2><button class="secondary" data-admin-jump="audit">Full audit</button></header><div class="activity-list">${result.recentEvents.length ? result.recentEvents.map(event => `<div class="activity-row"><span><b>${esc(event.action)}</b><small>${esc(event.actor?.username || 'system')}</small></span><small>${dateTime(event.createdAt)}</small></div>`).join('') : '<div class="admin-empty"><div><span>§</span><h3>No activity</h3></div></div>'}</div></article>
        <article class="glass admin-panel"><header><h2>Command shortcuts</h2></header><div class="activity-list">${adminAllowedTabs().filter(([tab]) => tab !== 'overview').slice(0, 7).map(([tab, icon, label]) => `<button class="activity-row" data-admin-jump="${tab}"><span><b>${icon} ${label}</b><small>Open management workspace</small></span><span>→</span></button>`).join('')}</div></article>
      </div>
    `;
    $$('[data-admin-jump]').forEach(button => button.onclick = () => loadAdminTab(button.dataset.adminJump));
  }

  async function renderAdminCatalog() {
    const [productResult, planResult] = await Promise.all([api('/api/admin/products'), api('/api/admin/plans')]);
    state.adminCache.products = productResult.products || [];
    state.adminCache.plans = planResult.plans || [];
    $('#adminContent').innerHTML = `
      <div class="glass admin-toolbar"><h2>Catalog</h2><div><button class="secondary" id="newPlan">New membership</button><button class="primary" id="newProduct">New product</button></div></div>
      <div class="admin-grid-2">
        <article class="glass admin-panel"><header><h2>Products</h2><span class="status-pill">${state.adminCache.products.length}</span></header>${catalogProductTable()}</article>
        <article class="glass admin-panel"><header><h2>Membership plans</h2><span class="status-pill">${state.adminCache.plans.length}</span></header>${catalogPlanTable()}</article>
      </div>
    `;
    $('#newProduct').onclick = () => openProductForm();
    $('#newPlan').onclick = () => openPlanForm();
    $$('[data-edit-product]').forEach(button => button.onclick = () => openProductForm(state.adminCache.products.find(item => item.id === button.dataset.editProduct)));
    $$('[data-edit-plan]').forEach(button => button.onclick = () => openPlanForm(state.adminCache.plans.find(item => item.id === button.dataset.editPlan)));
  }

  function catalogProductTable() {
    if (!state.adminCache.products.length) return '<div class="admin-empty"><div><span>▦</span><h3>No products</h3></div></div>';
    return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Product</th><th>Price</th><th>Status</th><th>Inventory</th><th></th></tr></thead><tbody>${state.adminCache.products.map(product => `<tr><td><b>${esc(product.name)}</b><small>${esc(product.type)}</small></td><td>${money(product.priceCents, product.currency)}</td><td><span class="status-pill ${esc(product.status)}">${esc(product.status)}</span></td><td>${product.inventory?.track ? product.inventory.quantity : 'Unlimited'}</td><td><button data-edit-product="${product.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
  }

  function catalogPlanTable() {
    if (!state.adminCache.plans.length) return '<div class="admin-empty"><div><span>◆</span><h3>No plans</h3></div></div>';
    return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Plan</th><th>Price</th><th>Status</th><th></th></tr></thead><tbody>${state.adminCache.plans.map(plan => `<tr><td><b>${esc(plan.name)}</b><small>${esc(plan.interval)}</small></td><td>${money(plan.priceCents, plan.currency)}</td><td><span class="status-pill ${esc(plan.status)}">${esc(plan.status)}</span></td><td><button data-edit-plan="${plan.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
  }

  function openProductForm(product = null) {
    modal(product ? 'Edit product' : 'New product', `
      <form class="admin-form" id="productForm">
        <div class="admin-form-grid">
          <label>Name<input name="name" value="${esc(product?.name || '')}" required></label>
          <label>Slug<input name="slug" value="${esc(product?.slug || '')}" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required></label>
          <label>Type<select name="type">${['digital', 'physical', 'service'].map(value => `<option ${product?.type === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
          <label>Status<select name="status">${['draft', 'active', 'archived'].map(value => `<option ${product?.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
          <label>Price in dollars<input name="price" type="number" min="0" step=".01" value="${((product?.priceCents || 0) / 100).toFixed(2)}" required></label>
          <label>Currency<input name="currency" value="${esc(product?.currency || 'USD')}" maxlength="3" required></label>
          <label>Inventory<input name="quantity" type="number" min="0" step="1" value="${product?.inventory?.quantity || 0}"></label>
          <label>Sort order<input name="sortOrder" type="number" min="0" value="${product?.sortOrder ?? 100}"></label>
          <label class="full">Image URL<input name="imageUrl" type="url" value="${esc(product?.imageUrl || '')}"></label>
          <label class="full">Tags<input name="tags" value="${esc((product?.tags || []).join(', '))}" placeholder="software, release, member"></label>
          <label class="full">Description<textarea name="description">${esc(product?.description || '')}</textarea></label>
        </div>
        <div class="toggle-row"><label><input name="trackInventory" type="checkbox" ${product?.inventory?.track ? 'checked' : ''}> Track inventory</label><label><input name="featured" type="checkbox" ${product?.featured ? 'checked' : ''}> Featured product</label></div>
        <button class="primary">Save product</button>
        ${product ? '<button class="secondary danger" type="button" id="archiveProduct">Archive product</button>' : ''}
      </form>
    `);
    $('#productForm').onsubmit = async event => {
      event.preventDefault();
      const form = new FormData(event.target);
      const body = {
        name: form.get('name').trim(),
        slug: form.get('slug').trim(),
        description: form.get('description').trim(),
        type: form.get('type'),
        status: form.get('status'),
        priceCents: Math.round(Number(form.get('price')) * 100),
        currency: form.get('currency').trim(),
        imageUrl: form.get('imageUrl').trim(),
        tags: form.get('tags').split(',').map(value => value.trim()).filter(Boolean),
        featured: form.has('featured'),
        sortOrder: Number(form.get('sortOrder') || 100),
        inventory: { track: form.has('trackInventory'), quantity: Number(form.get('quantity') || 0) },
        membershipRequired: null
      };
      try {
        await api(product ? `/api/admin/products/${product.id}` : '/api/admin/products', { method: product ? 'PUT' : 'POST', body });
        closeModal();
        await Promise.all([renderAdminCatalog(), loadCommerce()]);
      } catch (error) { window.SENSE_APP?.toast?.(error.message); }
    };
    if (product) $('#archiveProduct').onclick = async () => {
      if (!confirm(`Archive ${product.name}?`)) return;
      await api(`/api/admin/products/${product.id}`, { method: 'DELETE' });
      closeModal();
      await Promise.all([renderAdminCatalog(), loadCommerce()]);
    };
  }

  function openPlanForm(plan = null) {
    modal(plan ? 'Edit membership' : 'New membership', `
      <form class="admin-form" id="planForm">
        <div class="admin-form-grid">
          <label>Name<input name="name" value="${esc(plan?.name || '')}" required></label>
          <label>Slug<input name="slug" value="${esc(plan?.slug || '')}" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required></label>
          <label>Status<select name="status">${['draft', 'active', 'archived'].map(value => `<option ${plan?.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
          <label>Billing interval<select name="interval">${['month', 'year'].map(value => `<option ${plan?.interval === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
          <label>Price in dollars<input name="price" type="number" min="0" step=".01" value="${((plan?.priceCents || 0) / 100).toFixed(2)}" required></label>
          <label>Currency<input name="currency" value="${esc(plan?.currency || 'USD')}" maxlength="3" required></label>
          <label class="full">Benefits, one per line<textarea name="benefits">${esc((plan?.benefits || []).join('\n'))}</textarea></label>
          <label class="full">Description<textarea name="description">${esc(plan?.description || '')}</textarea></label>
        </div>
        <div class="toggle-row"><label><input name="featured" type="checkbox" ${plan?.featured ? 'checked' : ''}> Featured plan</label></div>
        <button class="primary">Save membership</button>
        ${plan ? '<button class="secondary danger" type="button" id="archivePlan">Archive membership</button>' : ''}
      </form>
    `);
    $('#planForm').onsubmit = async event => {
      event.preventDefault();
      const form = new FormData(event.target);
      const body = {
        name: form.get('name').trim(),
        slug: form.get('slug').trim(),
        description: form.get('description').trim(),
        status: form.get('status'),
        priceCents: Math.round(Number(form.get('price')) * 100),
        currency: form.get('currency').trim(),
        interval: form.get('interval'),
        benefits: form.get('benefits').split('\n').map(value => value.trim()).filter(Boolean),
        featured: form.has('featured'),
        sortOrder: 100
      };
      try {
        await api(plan ? `/api/admin/plans/${plan.id}` : '/api/admin/plans', { method: plan ? 'PUT' : 'POST', body });
        closeModal();
        await Promise.all([renderAdminCatalog(), loadCommerce()]);
      } catch (error) { window.SENSE_APP?.toast?.(error.message); }
    };
    if (plan) $('#archivePlan').onclick = async () => {
      if (!confirm(`Archive ${plan.name}?`)) return;
      await api(`/api/admin/plans/${plan.id}`, { method: 'DELETE' });
      closeModal();
      await Promise.all([renderAdminCatalog(), loadCommerce()]);
    };
  }

  async function renderAdminOrders() {
    const result = await api('/api/admin/orders?limit=500');
    state.adminCache.orders = result.orders || [];
    $('#adminContent').innerHTML = `
      <div class="glass admin-toolbar"><h2>Orders</h2><div><span class="status-pill">${state.adminCache.orders.length}</span><button class="secondary" id="refreshAdminOrders">Refresh</button></div></div>
      ${state.adminCache.orders.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Fulfillment</th><th></th></tr></thead><tbody>${state.adminCache.orders.map(order => `<tr><td><b>${esc(order.number)}</b><small>${dateTime(order.createdAt)}</small></td><td>${esc(order.customer?.displayName || 'Unknown')}<small>${esc(order.customer?.email || '')}</small></td><td>${money(order.totalCents, order.currency)}</td><td><span class="status-pill ${esc(order.status)}">${esc(order.status)}</span><small>${esc(order.paymentProvider)}</small></td><td>${esc(order.fulfillmentStatus)}</td><td><button data-manage-order="${order.id}">Manage</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="admin-empty"><div><span>⌁</span><h3>No orders</h3></div></div>'}
    `;
    $('#refreshAdminOrders').onclick = renderAdminOrders;
    $$('[data-manage-order]').forEach(button => button.onclick = () => openOrderForm(state.adminCache.orders.find(order => order.id === button.dataset.manageOrder)));
  }

  function openOrderForm(order) {
    modal(`Order ${order.number}`, `
      <form class="admin-form" id="orderForm">
        <div class="admin-grid-2"><div><span class="status-pill ${esc(order.status)}">${esc(order.status)}</span><h3>${money(order.totalCents, order.currency)}</h3><p>${esc(order.customer?.displayName || '')}<br>${esc(order.customer?.email || '')}</p></div><div>${(order.lineItems || []).map(item => `<p>${item.quantity} × ${esc(item.name)} — ${money(item.totalCents, order.currency)}</p>`).join('')}</div></div>
        <label>Fulfillment<select name="fulfillmentStatus">${['unfulfilled', 'processing', 'fulfilled', 'cancelled'].map(value => `<option ${order.fulfillmentStatus === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
        <label>Internal note<textarea name="note"></textarea></label>
        <button class="primary">Update order</button>
      </form>
      ${['paid', 'fulfilled', 'partially_refunded'].includes(order.status) ? `<hr><form class="admin-form" id="refundForm"><h3>Refund</h3><label>Amount in dollars<input name="amount" type="number" min=".01" max="${((order.totalCents - order.refundedCents) / 100).toFixed(2)}" step=".01" required></label><label>Reason<textarea name="reason" required></textarea></label><button class="secondary danger">Issue refund</button></form>` : ''}
    `);
    $('#orderForm').onsubmit = async event => {
      event.preventDefault();
      const form = new FormData(event.target);
      await api(`/api/admin/orders/${order.id}`, { method: 'PATCH', body: { fulfillmentStatus: form.get('fulfillmentStatus'), note: form.get('note').trim() } });
      closeModal();
      renderAdminOrders();
    };
    if ($('#refundForm')) $('#refundForm').onsubmit = async event => {
      event.preventDefault();
      if (!confirm('Issue this refund through the payment provider?')) return;
      const form = new FormData(event.target);
      try {
        await api(`/api/admin/orders/${order.id}/refund`, { method: 'POST', body: { amountCents: Math.round(Number(form.get('amount')) * 100), reason: form.get('reason').trim() } });
        closeModal();
        renderAdminOrders();
      } catch (error) { window.SENSE_APP?.toast?.(error.message); }
    };
  }

  async function renderAdminMemberships() {
    const result = await api('/api/admin/memberships?limit=500');
    state.adminCache.memberships = result.memberships || [];
    $('#adminContent').innerHTML = `
      <div class="glass admin-toolbar"><h2>Memberships</h2><span class="status-pill">${state.adminCache.memberships.length}</span></div>
      ${state.adminCache.memberships.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Member</th><th>Plan</th><th>Provider</th><th>Period end</th><th>Status</th><th></th></tr></thead><tbody>${state.adminCache.memberships.map(item => `<tr><td><b>${esc(item.customer?.displayName || '')}</b><small>${esc(item.customer?.email || '')}</small></td><td>${esc(item.plan?.name || '')}</td><td>${esc(item.provider)}</td><td>${dateTime(item.currentPeriodEnd)}</td><td><span class="status-pill ${esc(item.status)}">${esc(item.status)}</span></td><td><button data-manage-membership="${item.id}">Manage</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="admin-empty"><div><span>◆</span><h3>No memberships</h3></div></div>'}
    `;
    $$('[data-manage-membership]').forEach(button => button.onclick = () => openMembershipForm(state.adminCache.memberships.find(item => item.id === button.dataset.manageMembership)));
  }

  function openMembershipForm(item) {
    modal('Manage membership', `
      <form class="admin-form" id="membershipForm">
        <p><b>${esc(item.customer?.displayName || '')}</b><br>${esc(item.plan?.name || '')} · ${esc(item.provider)}</p>
        <label>Status<select name="status">${['active', 'past_due', 'paused', 'cancelled'].map(value => `<option ${item.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
        <label>Period end<input name="currentPeriodEnd" type="datetime-local" value="${item.currentPeriodEnd ? new Date(item.currentPeriodEnd).toISOString().slice(0, 16) : ''}"></label>
        <button class="primary">Save membership</button>
      </form>
    `);
    $('#membershipForm').onsubmit = async event => {
      event.preventDefault();
      const form = new FormData(event.target);
      const period = form.get('currentPeriodEnd');
      await api(`/api/admin/memberships/${item.id}`, { method: 'PATCH', body: { status: form.get('status'), ...(period ? { currentPeriodEnd: new Date(period).toISOString() } : {}) } });
      closeModal();
      renderAdminMemberships();
    };
  }

  async function renderAdminUsers(query = '') {
    const result = await api(`/api/admin/users?limit=500${query ? `&q=${encodeURIComponent(query)}` : ''}`);
    state.adminCache.users = result.users || [];
    $('#adminContent').innerHTML = `
      <div class="glass admin-toolbar"><h2>Users</h2><div><input id="adminUserSearch" type="search" placeholder="Search users" value="${esc(query)}"><span class="status-pill">${state.adminCache.users.length}</span></div></div>
      ${state.adminCache.users.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last seen</th><th></th></tr></thead><tbody>${state.adminCache.users.map(user => `<tr><td><b>${esc(user.displayName)}</b><small>${esc(user.email)} · @${esc(user.username)}</small></td><td><select data-user-role="${user.id}">${['owner', 'admin', 'support', 'editor', 'analyst', 'member'].map(value => `<option ${user.role === value ? 'selected' : ''}>${value}</option>`).join('')}</select></td><td><select data-user-status="${user.id}">${['active', 'suspended'].map(value => `<option ${user.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select></td><td>${dateTime(user.lastSeenAt)}</td><td><button data-save-user="${user.id}">Save</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="admin-empty"><div><span>◎</span><h3>No users</h3></div></div>'}
    `;
    let timer;
    $('#adminUserSearch').oninput = event => {
      clearTimeout(timer);
      timer = setTimeout(() => renderAdminUsers(event.target.value.trim()), 300);
    };
    $$('[data-save-user]').forEach(button => button.onclick = async () => {
      const userId = button.dataset.saveUser;
      try {
        await api(`/api/admin/users/${userId}`, {
          method: 'PATCH',
          body: {
            role: $(`[data-user-role="${userId}"]`).value,
            status: $(`[data-user-status="${userId}"]`).value
          }
        });
        window.SENSE_APP?.toast?.('User updated');
        renderAdminUsers($('#adminUserSearch').value.trim());
      } catch (error) { window.SENSE_APP?.toast?.(error.message); }
    });
  }

  async function renderAdminChats(query = '') {
    const result = await api(`/api/admin/messages?limit=500${query ? `&q=${encodeURIComponent(query)}` : ''}`);
    state.adminCache.messages = result.messages || [];
    $('#adminContent').innerHTML = `
      <div class="glass admin-toolbar"><h2>Chat management</h2><div><input id="adminChatSearch" type="search" placeholder="Search message content" value="${esc(query)}"><span class="status-pill">${state.adminCache.messages.length}</span></div></div>
      ${state.adminCache.messages.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Message</th><th>From</th><th>To</th><th>Date</th><th>State</th><th></th></tr></thead><tbody>${state.adminCache.messages.map(message => `<tr><td class="chat-body">${esc(message.body)}</td><td>${esc(message.sender?.displayName || '')}</td><td>${esc(message.recipient?.displayName || '')}</td><td>${dateTime(message.createdAt)}</td><td><span class="status-pill ${message.hidden ? 'suspended' : 'active'}">${message.hidden ? 'hidden' : 'visible'}</span></td><td><button data-moderate-message="${message.id}">${message.hidden ? 'Restore' : 'Hide'}</button> <button class="danger" data-delete-message="${message.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="admin-empty"><div><span>✉</span><h3>No messages</h3></div></div>'}
    `;
    let timer;
    $('#adminChatSearch').oninput = event => {
      clearTimeout(timer);
      timer = setTimeout(() => renderAdminChats(event.target.value.trim()), 300);
    };
    $$('[data-moderate-message]').forEach(button => button.onclick = async () => {
      const message = state.adminCache.messages.find(item => item.id === button.dataset.moderateMessage);
      const reason = message.hidden ? '' : prompt('Moderation reason') || '';
      if (!message.hidden && !reason) return;
      await api(`/api/admin/messages/${message.id}`, { method: 'PATCH', body: { hidden: !message.hidden, reason } });
      renderAdminChats($('#adminChatSearch').value.trim());
    });
    $$('[data-delete-message]').forEach(button => button.onclick = async () => {
      if (!confirm('Soft-delete this message from all conversation views?')) return;
      await api(`/api/admin/messages/${button.dataset.deleteMessage}`, { method: 'DELETE' });
      renderAdminChats($('#adminChatSearch').value.trim());
    });
  }

  function bars(rows, valueKey, formatter = value => String(value)) {
    const maximum = Math.max(1, ...rows.map(row => Number(row[valueKey] || 0)));
    return `<div class="chart-shell">${rows.length ? rows.map(row => `<div class="bar-row"><span>${esc(row.name || row.date)}</span><div class="bar-track"><i style="width:${Math.max(1, Number(row[valueKey] || 0) / maximum * 100)}%"></i></div><b>${esc(formatter(row[valueKey] || 0))}</b></div>`).join('') : '<div class="admin-empty"><div><span>⌇</span><h3>No activity in range</h3></div></div>'}</div>`;
  }

  async function renderAdminAnalytics(days = 30) {
    const result = await api(`/api/admin/analytics?days=${days}`);
    state.adminCache.analytics = result;
    const revenueTotal = result.revenue.reduce((sum, item) => sum + item.amountCents, 0);
    const chatTotal = result.chats.reduce((sum, item) => sum + item.count, 0);
    const signupTotal = result.signups.reduce((sum, item) => sum + item.count, 0);
    $('#adminContent').innerHTML = `
      <div class="glass admin-toolbar"><h2>Platform intelligence</h2><div><select id="analyticsDays">${[7, 30, 90, 365].map(value => `<option value="${value}" ${Number(days) === value ? 'selected' : ''}>${value} days</option>`).join('')}</select></div></div>
      <div class="admin-kpis">${kpi('Revenue', money(revenueTotal))}${kpi('Messages', chatTotal)}${kpi('New users', signupTotal)}${kpi('Tracked events', result.events.reduce((sum, item) => sum + item.count, 0))}</div>
      <div class="admin-grid-2">
        <article class="glass admin-panel"><header><h2>Revenue by day</h2></header>${bars(result.revenue, 'amountCents', value => money(value))}</article>
        <article class="glass admin-panel"><header><h2>Messages by day</h2></header>${bars(result.chats, 'count')}</article>
        <article class="glass admin-panel"><header><h2>Signups by day</h2></header>${bars(result.signups, 'count')}</article>
        <article class="glass admin-panel"><header><h2>Event mix</h2></header>${bars(result.events, 'count')}</article>
      </div>
    `;
    $('#analyticsDays').onchange = event => renderAdminAnalytics(Number(event.target.value));
  }

  async function renderAdminPayments() {
    const result = await api('/api/admin/payments');
    $('#adminContent').innerHTML = `
      <div class="glass admin-toolbar"><h2>Payment operations</h2><span class="status-pill">${esc(result.currency)}</span></div>
      <div class="provider-grid">
        ${providerCard('Stripe', result.providers.stripe, result.webhookPaths.stripe)}
        ${providerCard('Coinbase Business', result.providers.coinbase, result.webhookPaths.coinbase)}
      </div>
      <article class="glass admin-panel" style="margin-top:12px"><header><h2>Operational rule</h2></header><p class="page-subtitle">Orders become paid only after a verified provider webhook. Provider secrets stay on the server and are never exposed to this dashboard.</p></article>
    `;
  }

  function providerCard(name, provider, webhookPath) {
    return `<article class="glass provider-card"><header><div><h2>${esc(name)}</h2><p class="page-subtitle">${provider.enabled ? 'Connected' : 'Awaiting credentials'}</p></div><span class="status-pill ${provider.enabled && provider.webhookConfigured ? 'active' : 'pending'}">${provider.enabled && provider.webhookConfigured ? 'Ready' : 'Setup'}</span></header><ul>${provider.capabilities.map(item => `<li>${esc(item)}</li>`).join('')}</ul><label>Webhook endpoint<code>${esc(`${apiBase()}${webhookPath}`)}</code></label></article>`;
  }

  async function renderAdminTheme() {
    const result = await api('/api/admin/settings');
    const value = result.settings;
    state.adminCache.settings = value;
    $('#adminContent').innerHTML = `
      <div class="glass admin-toolbar"><h2>Theme system</h2><span class="status-pill active">Live tokens</span></div>
      <article class="glass admin-panel">
        <form class="theme-form" id="themeForm">
          <div class="theme-grid">
            ${colorInput('background', 'Background', value.theme.background)}
            ${colorInput('surface', 'Surface', value.theme.surface)}
            ${colorInput('accent', 'Accent', value.theme.accent)}
            ${colorInput('accentStrong', 'Strong accent', value.theme.accentStrong)}
            ${colorInput('text', 'Text', value.theme.text)}
            ${colorInput('muted', 'Muted text', value.theme.muted)}
            <label>Corner radius<input name="radius" type="range" min="0" max="40" value="${value.theme.radius}"></label>
            <label>Interface scale<input name="fontScale" type="range" min=".85" max="1.35" step=".05" value="${value.theme.fontScale}"></label>
            <label>Brand name<input name="brandName" value="${esc(value.brandName)}"></label>
            <label>Support email<input name="supportEmail" type="email" value="${esc(value.supportEmail || '')}"></label>
          </div>
          <div class="toggle-row">
            <label><input name="storeEnabled" type="checkbox" ${value.storeEnabled ? 'checked' : ''}> Shop enabled</label>
            <label><input name="membershipsEnabled" type="checkbox" ${value.membershipsEnabled ? 'checked' : ''}> Memberships enabled</label>
            <label><input name="registrationEnabled" type="checkbox" ${value.registrationEnabled ? 'checked' : ''}> Registration enabled</label>
          </div>
          <button class="primary">Save theme and platform settings</button>
        </form>
      </article>
    `;
    $('#themeForm').oninput = event => {
      if (event.target.type === 'color' || ['radius', 'fontScale'].includes(event.target.name)) applyTheme(themeFromForm(event.currentTarget));
    };
    $('#themeForm').onsubmit = async event => {
      event.preventDefault();
      const form = new FormData(event.target);
      const body = {
        brandName: form.get('brandName').trim(),
        theme: themeFromForm(event.target),
        storeEnabled: form.has('storeEnabled'),
        membershipsEnabled: form.has('membershipsEnabled'),
        registrationEnabled: form.has('registrationEnabled'),
        supportEmail: form.get('supportEmail').trim()
      };
      try {
        const saved = await api('/api/admin/settings', { method: 'PUT', body });
        state.config = { ...state.config, brandName: saved.settings.brandName, theme: saved.settings.theme, features: { store: saved.settings.storeEnabled, memberships: saved.settings.membershipsEnabled, registration: saved.settings.registrationEnabled } };
        applyTheme(saved.settings.theme);
        window.SENSE_APP?.toast?.('Theme published');
      } catch (error) { window.SENSE_APP?.toast?.(error.message); }
    };
  }

  function colorInput(name, label, value) {
    return `<label class="color-field"><input name="${name}" type="color" value="${esc(value)}"><span>${esc(label)}<small>${esc(value)}</small></span></label>`;
  }

  function themeFromForm(formNode) {
    const form = new FormData(formNode);
    return {
      background: form.get('background'),
      surface: form.get('surface'),
      accent: form.get('accent'),
      accentStrong: form.get('accentStrong'),
      text: form.get('text'),
      muted: form.get('muted'),
      radius: Number(form.get('radius')),
      fontScale: Number(form.get('fontScale'))
    };
  }

  function renderAdminBroadcasts() {
    $('#adminContent').innerHTML = `
      <div class="glass admin-toolbar"><h2>Broadcast center</h2><span class="status-pill">All members</span></div>
      <article class="glass admin-panel">
        <form class="admin-form" id="platformBroadcastForm">
          <label>Title<input name="title" maxlength="100" required></label>
          <label>Priority<select name="level"><option>info</option><option>warning</option><option>critical</option></select></label>
          <label>Message<textarea name="body" maxlength="2000" required></textarea></label>
          <button class="primary">Publish broadcast</button>
        </form>
      </article>
    `;
    $('#platformBroadcastForm').onsubmit = async event => {
      event.preventDefault();
      const form = new FormData(event.target);
      try {
        await api('/api/admin/broadcasts', { method: 'POST', body: { title: form.get('title').trim(), body: form.get('body').trim(), level: form.get('level') } });
        event.target.reset();
        window.SENSE_APP?.toast?.('Broadcast published');
      } catch (error) { window.SENSE_APP?.toast?.(error.message); }
    };
  }

  async function renderAdminAudit() {
    const result = await api('/api/admin/audit?limit=500');
    $('#adminContent').innerHTML = `
      <div class="glass admin-toolbar"><h2>Audit trail</h2><span class="status-pill">${result.events.length}</span></div>
      ${result.events.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Action</th><th>Actor</th><th>Time</th><th>Metadata</th></tr></thead><tbody>${result.events.map(event => `<tr><td><b>${esc(event.action)}</b></td><td>${esc(event.actor?.username || 'system')}<small>${esc(event.actor?.role || '')}</small></td><td>${dateTime(event.createdAt)}</td><td class="chat-body">${esc(JSON.stringify(event.metadata || {}))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="admin-empty"><div><span>§</span><h3>No audit activity</h3></div></div>'}
    `;
  }

  function trackRoute(view) {
    if (!view || !apiBase()) return;
    api('/api/analytics/events', {
      method: 'POST',
      body: { name: 'page_view', path: `/${view}`, referrer: document.referrer, properties: { view } },
      timeout: 5000
    }).catch(() => {});
  }

  function bind() {
    window.SENSE_AUTH = { login, register, logout };
    $$('[data-auth-tab]').forEach(button => button.onclick = () => {
      $$('[data-auth-tab]').forEach(item => item.classList.toggle('active', item === button));
      $('#loginForm').classList.toggle('hidden', button.dataset.authTab !== 'login');
      $('#registerForm').classList.toggle('hidden', button.dataset.authTab !== 'register');
      status('');
    });
    $('#registerForm').onsubmit = event => { event.preventDefault(); register(); };
    $('#storeSearch').oninput = renderProducts;
    $('#refreshOrders').onclick = refreshOrders;
    $('#manageBilling').onclick = openBilling;
    $('#openCart').onclick = () => $('#cartPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#messageForm').onsubmit = event => { event.preventDefault(); sendMessage(); };
    document.addEventListener('click', event => {
      const add = event.target.closest('[data-cart-add]');
      if (add) addToCart(add.dataset.cartAdd);
      const change = event.target.closest('[data-cart-change]');
      if (change) changeCart(change.dataset.cartChange, Number(change.dataset.delta));
      const checkoutNode = event.target.closest('[data-checkout-kind]');
      if (checkoutNode) checkout(checkoutNode.dataset.checkoutKind, checkoutNode.dataset.checkoutProvider, checkoutNode.dataset.checkoutId);
    });
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-create="conversation"]');
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openNewMessage();
    }, true);
    window.addEventListener('sense:workspace-change', scheduleWorkspaceSync);
    window.addEventListener('sense:enterprise-change', scheduleWorkspaceSync);
    window.addEventListener('sense:route', event => {
      const view = event.detail?.view;
      trackRoute(view);
      if (view === 'messages') loadConversations();
      if (view === 'store') renderCommerce();
      if (view === 'memberships') renderMemberships();
      if (view === 'orders') refreshOrders();
      if (view === 'admin') {
        if (canAdmin()) loadAdminTab();
        else {
          window.SENSE_APP?.show?.('home');
          window.SENSE_APP?.toast?.('Administrator access required');
        }
      }
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
  }

  async function init() {
    bind();
    await loadConfig();
    await restoreSession();
    if (!state.user && /^#\/(store|memberships)/.test(location.hash)) {
      try { await loadCommerce(); } catch {}
    }
    const enterpriseTimer = setInterval(() => {
      if (!window.SENSE_ENTERPRISE) return;
      clearInterval(enterpriseTimer);
      if (state.pendingEnterprise) {
        window.SENSE_ENTERPRISE.importState?.(state.pendingEnterprise);
        state.pendingEnterprise = null;
      }
    }, 100);
    setTimeout(() => clearInterval(enterpriseTimer), 10_000);
  }

  window.SENSE_PLATFORM = {
    version: '1.0.2',
    api,
    state,
    refresh: loadCommerce,
    openAdmin: tab => {
      window.SENSE_APP?.show?.('admin');
      loadAdminTab(tab);
    }
  };

  init();
})();
