(() => {
  'use strict';

  const VERSION = '1.0.2';
  const STORE = 'sense.enterprise.v1';
  const WORKSPACE_STORE = 'sense.workspace.empty.v1';
  const STAGES = ['New', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'];
  const DEAL_STAGES = ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];
  const EMPTY = {
    forms: [], applications: [], companies: [], contacts: [], deals: [],
    invoices: [], expenses: [], budgets: [], vendors: [], contracts: [],
    onboarding: [], reviews: [], goals: [], campaigns: [], leads: [],
    events: [], settings: { currency: 'USD', fiscalYearStart: 1 }
  };

  const state = load();
  let activeFormId = null;
  let activeFormTab = 'build';
  let activeCareerTab = 'openings';
  let activeAnalyticsTab = 'overview';
  let analyticsRange = 30;
  let modalCloseHandler = null;
  let booted = false;

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  const uid = prefix => `${prefix}_${(globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 18)}`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: state.settings.currency || 'USD', maximumFractionDigits: 0 }).format(Number(value || 0));
  const dateText = value => value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : '';
  const dateTime = value => value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '';

  function load() {
    try {
      const value = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (!value || typeof value !== 'object') return clone(EMPTY);
      return { ...clone(EMPTY), ...value, settings: { ...EMPTY.settings, ...(value.settings || {}) } };
    } catch {
      return clone(EMPTY);
    }
  }

  function save(action = '') {
    if (action) log(action);
    localStorage.setItem(STORE, JSON.stringify(state));
    renderAll();
    syncPublicCareers();
    window.dispatchEvent(new CustomEvent('sense:enterprise-change', { detail: { enterprise: state } }));
  }

  function log(type, metadata = {}) {
    state.events.unshift({ id: uid('evt'), type, metadata, at: new Date().toISOString() });
    state.events = state.events.slice(0, 2000);
  }

  function workspaceState() {
    try { return JSON.parse(localStorage.getItem(WORKSPACE_STORE) || '{}') || {}; }
    catch { return {}; }
  }

  function role() {
    return window.SENSE_SESSION?.user?.role || 'member';
  }

  function canAdmin() { return ['owner', 'admin'].includes(role()); }

  function toast(text) {
    let node = $('#toast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'toast';
      node.className = 'toast';
      document.body.append(node);
    }
    node.textContent = text;
    node.classList.add('show');
    clearTimeout(node._timer);
    node._timer = setTimeout(() => node.classList.remove('show'), 2400);
  }

  function empty(icon, title, detail = '') {
    return `<div class="enterprise-empty"><span>${icon}</span><h3>${esc(title)}</h3>${detail ? `<p>${esc(detail)}</p>` : ''}</div>`;
  }

  function injectShell() {
    if ($('#enterpriseModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <section class="enterprise-modal hidden" id="enterpriseModal" role="dialog" aria-modal="true">
        <div class="glass enterprise-modal-card"><header><h2 id="enterpriseModalTitle"></h2><button id="enterpriseModalClose">×</button></header><div id="enterpriseModalBody"></div></div>
      </section>
      <section class="enterprise-public hidden" id="enterprisePublic"><header><button id="enterprisePublicHome"><img src="./icon.svg" alt=""><b>SENSE</b></button><button id="enterprisePublicClose">×</button></header><main id="enterprisePublicBody"></main></section>
    `);
    $('#enterpriseModalClose').onclick = closeModal;
    $('#enterpriseModal').addEventListener('click', event => { if (event.target === $('#enterpriseModal')) closeModal(); });
    $('#enterprisePublicClose').onclick = closePublic;
    $('#enterprisePublicHome').onclick = closePublic;
  }

  function injectViews() {
    const workspace = $('#workspace');
    if (!workspace || $('#view-executive')) return;
    workspace.insertAdjacentHTML('beforeend', `
      <section class="view enterprise-view" id="view-executive"><header class="page-head"><h1>Executive</h1><div class="page-actions"><button class="secondary" id="executiveExport">Export report</button></div></header><div id="executiveDashboard"></div></section>
      <section class="view enterprise-view" id="view-crm"><header class="page-head"><h1>CRM</h1><div class="page-actions"><button class="secondary" data-enterprise-create="company">New company</button><button class="secondary" data-enterprise-create="contact">New contact</button><button class="primary" data-enterprise-create="deal">New deal</button></div></header><div class="enterprise-tabs"><button class="active" data-crm-tab="pipeline">Pipeline</button><button data-crm-tab="companies">Companies</button><button data-crm-tab="contacts">Contacts</button></div><div id="crmContent"></div></section>
      <section class="view enterprise-view" id="view-finance"><header class="page-head"><h1>Finance</h1><div class="page-actions"><button class="secondary" data-enterprise-create="expense">New expense</button><button class="primary" data-enterprise-create="invoice">New invoice</button></div></header><div class="enterprise-tabs"><button class="active" data-finance-tab="overview">Overview</button><button data-finance-tab="invoices">Invoices</button><button data-finance-tab="expenses">Expenses</button><button data-finance-tab="budgets">Budgets</button></div><div id="financeContent"></div></section>
      <section class="view enterprise-view" id="view-peopleops"><header class="page-head"><h1>People Operations</h1><div class="page-actions"><button class="secondary" data-enterprise-create="goal">New goal</button><button class="secondary" data-enterprise-create="review">New review</button><button class="primary" data-enterprise-create="onboarding">Start onboarding</button></div></header><div class="enterprise-tabs"><button class="active" data-people-tab="onboarding">Onboarding</button><button data-people-tab="reviews">Reviews</button><button data-people-tab="goals">Goals</button></div><div id="peopleOpsContent"></div></section>
      <section class="view enterprise-view" id="view-vendors"><header class="page-head"><h1>Vendors & Contracts</h1><div class="page-actions"><button class="secondary" data-enterprise-create="vendor">New vendor</button><button class="primary" data-enterprise-create="contract">New contract</button></div></header><div class="enterprise-tabs"><button class="active" data-vendor-tab="vendors">Vendors</button><button data-vendor-tab="contracts">Contracts</button></div><div id="vendorsContent"></div></section>
      <section class="view enterprise-view" id="view-marketing"><header class="page-head"><h1>Growth</h1><div class="page-actions"><button class="secondary" data-enterprise-create="lead">New lead</button><button class="primary" data-enterprise-create="campaign">New campaign</button></div></header><div class="enterprise-tabs"><button class="active" data-growth-tab="campaigns">Campaigns</button><button data-growth-tab="leads">Leads</button></div><div id="marketingContent"></div></section>
      <section class="view enterprise-view" id="view-applications"><header class="page-head"><h1>Applications</h1><div class="page-actions"><button class="secondary" id="applicationsExport">Export CSV</button></div></header><div id="applicationsContent"></div></section>
      <section class="view enterprise-view" id="view-formresponses"><header class="page-head"><h1>Form Responses</h1></header><div id="allResponsesContent"></div></section>
    `);

    const more = $('#view-more .more-grid');
    if (more) {
      more.insertAdjacentHTML('afterbegin', `
        <button class="glass more-card enterprise-nav" data-enterprise-view="executive"><span>◈</span><b>Executive</b></button>
        <button class="glass more-card enterprise-nav" data-enterprise-view="crm"><span>◎</span><b>CRM</b></button>
        <button class="glass more-card enterprise-nav" data-enterprise-view="finance"><span>$</span><b>Finance</b></button>
        <button class="glass more-card enterprise-nav" data-enterprise-view="peopleops"><span>◇</span><b>People Ops</b></button>
        <button class="glass more-card enterprise-nav" data-enterprise-view="vendors"><span>⌘</span><b>Vendors</b></button>
        <button class="glass more-card enterprise-nav" data-enterprise-view="marketing"><span>↗</span><b>Growth</b></button>
        <button class="glass more-card enterprise-nav" data-enterprise-view="applications"><span>▤</span><b>Applications</b></button>
        <button class="glass more-card enterprise-nav" data-enterprise-view="formresponses"><span>≡</span><b>Responses</b></button>
      `);
    }

    const home = $('#homeModules');
    if (home) {
      home.insertAdjacentHTML('beforeend', `
        <button class="module-card glass enterprise-nav" data-enterprise-view="executive"><span>◈</span><b>Executive</b><small>Live</small></button>
        <button class="module-card glass enterprise-nav" data-enterprise-view="crm"><span>◎</span><b>CRM</b><small id="homeDealCount">0</small></button>
        <button class="module-card glass enterprise-nav" data-enterprise-view="finance"><span>$</span><b>Finance</b><small id="homeInvoiceCount">0</small></button>
        <button class="module-card glass enterprise-nav" data-enterprise-view="applications"><span>▤</span><b>Applicants</b><small id="homeApplicantCount">0</small></button>
      `);
    }
  }

  function upgradeFormsPage() {
    const view = $('#view-forms');
    if (!view || view.dataset.enterprise === '1') return;
    view.dataset.enterprise = '1';
    view.innerHTML = `
      <header class="page-head"><div><h1>Forms</h1><p class="page-subtitle">Build, publish, collect, and analyze structured responses.</p></div><div class="page-actions"><button class="secondary enterprise-nav" data-enterprise-view="formresponses">All responses</button><button class="primary" id="newEnterpriseForm">New form</button></div></header>
      <div class="form-studio glass"><aside><div class="studio-search"><input id="formSearch" placeholder="Search forms"></div><div id="formList"></div></aside><main><div id="formEditor"></div></main></div>
    `;
  }

  function upgradeCareersPage() {
    const view = $('#view-careers');
    if (!view || view.dataset.enterprise === '1') return;
    view.dataset.enterprise = '1';
    view.innerHTML = `
      <header class="page-head"><div><h1>Talent</h1><p class="page-subtitle">Open roles, applications, interviews, and hiring pipeline.</p></div><div class="page-actions"><button class="secondary" id="openPublicCareers">Public careers</button><button class="primary" id="newEnterpriseJob">New opening</button></div></header>
      <div class="enterprise-tabs"><button class="active" data-career-tab="openings">Openings</button><button data-career-tab="pipeline">Pipeline</button><button data-career-tab="analytics">Recruiting analytics</button></div>
      <div id="careerContent"></div>
    `;
  }

  function upgradeAnalyticsPage() {
    const view = $('#view-analytics');
    if (!view || view.dataset.enterprise === '1') return;
    view.dataset.enterprise = '1';
    view.innerHTML = `
      <header class="page-head"><div><h1>Analytics</h1><p class="page-subtitle">Operational, growth, people, recruiting, and finance intelligence.</p></div><div class="page-actions"><select id="analyticsRange"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">90 days</option><option value="0">All time</option></select><button class="secondary" id="analyticsExport">Export</button></div></header>
      <div class="enterprise-tabs"><button class="active" data-analytics-tab="overview">Overview</button><button data-analytics-tab="growth">Growth</button><button data-analytics-tab="people">People</button><button data-analytics-tab="operations">Operations</button></div>
      <div id="enterpriseAnalytics"></div>
    `;
  }

  function enterpriseShow(view, replace = false) {
    const node = $(`#view-${view}`);
    if (!node) return;
    $$('.view').forEach(item => item.classList.toggle('active', item === node));
    $$('.nav-target,.enterprise-nav').forEach(button => button.classList.toggle('active', button.dataset.enterpriseView === view));
    const title = { executive:'Executive', crm:'CRM', finance:'Finance', peopleops:'People Operations', vendors:'Vendors & Contracts', marketing:'Growth', applications:'Applications', formresponses:'Form Responses' }[view] || 'SENSE';
    if ($('#viewTitle')) $('#viewTitle').textContent = title;
    if ($('#workspace')) $('#workspace').scrollTop = 0;
    const hash = `#/${view}`;
    if (location.hash !== hash) replace ? history.replaceState(null, '', hash) : history.pushState(null, '', hash);
    renderAll();
  }

  function openModal(title, body, onReady) {
    $('#enterpriseModalTitle').textContent = title;
    $('#enterpriseModalBody').innerHTML = body;
    $('#enterpriseModal').classList.remove('hidden');
    modalCloseHandler = null;
    onReady?.();
  }

  function closeModal() {
    modalCloseHandler?.();
    modalCloseHandler = null;
    $('#enterpriseModal').classList.add('hidden');
    $('#enterpriseModalBody').innerHTML = '';
  }

  function openPublic(body) {
    $('#enterprisePublicBody').innerHTML = body;
    $('#enterprisePublic').classList.remove('hidden');
    document.documentElement.style.overflow = 'hidden';
  }

  function closePublic() {
    $('#enterprisePublic').classList.add('hidden');
    $('#enterprisePublicBody').innerHTML = '';
    document.documentElement.style.overflow = '';
    if (/^#\/(jobs|form)\//.test(location.hash)) history.replaceState(null, '', '#/public/careersPublic');
  }

  function renderForms() {
    const list = $('#formList');
    const editor = $('#formEditor');
    if (!list || !editor) return;
    const query = ($('#formSearch')?.value || '').trim().toLowerCase();
    const forms = state.forms.filter(item => `${item.name} ${item.description || ''}`.toLowerCase().includes(query));
    list.innerHTML = forms.length ? forms.map(item => `<button class="studio-list-item ${item.id === activeFormId ? 'active' : ''}" data-form-id="${item.id}"><span><b>${esc(item.name)}</b><small>${item.status || 'Draft'} · ${(item.responses || []).length} responses</small></span><i>›</i></button>`).join('') : empty('≡', 'No forms', 'Create a form to begin collecting responses.');
    if (!activeFormId || !state.forms.some(item => item.id === activeFormId)) activeFormId = state.forms[0]?.id || null;
    const form = state.forms.find(item => item.id === activeFormId);
    if (!form) {
      editor.innerHTML = `<div class="studio-welcome">${empty('≡', 'Form studio', 'Create your first form, add fields, publish it, and collect responses.')}</div>`;
      return;
    }
    editor.innerHTML = `
      <header class="studio-header"><div><input class="studio-title" id="formName" value="${esc(form.name)}" aria-label="Form name"><input class="studio-description" id="formDescription" value="${esc(form.description || '')}" placeholder="Description"></div><div class="studio-actions"><span class="status-pill ${String(form.status).toLowerCase()}">${esc(form.status || 'Draft')}</span><button class="secondary" id="previewForm">Preview</button><button class="primary" id="publishForm">${form.status === 'Published' ? 'Unpublish' : 'Publish'}</button></div></header>
      <nav class="studio-tabs"><button class="${activeFormTab === 'build' ? 'active' : ''}" data-form-tab="build">Build</button><button class="${activeFormTab === 'responses' ? 'active' : ''}" data-form-tab="responses">Responses <b>${(form.responses || []).length}</b></button><button class="${activeFormTab === 'share' ? 'active' : ''}" data-form-tab="share">Share</button></nav>
      <div id="formTabContent"></div>
    `;
    renderFormTab(form);
  }

  function renderFormTab(form) {
    const root = $('#formTabContent');
    if (!root) return;
    if (activeFormTab === 'build') {
      root.innerHTML = `
        <div class="builder-layout"><section><div class="field-list" id="fieldList">${form.fields.length ? form.fields.map((field, index) => fieldEditor(field, index, form.fields.length)).join('') : empty('＋', 'No fields', 'Add a field from the panel.')}</div></section>
        <aside class="field-palette glass"><h3>Add field</h3>${[['text','Short text'],['textarea','Long text'],['email','Email'],['number','Number'],['date','Date'],['select','Dropdown'],['checkbox','Checkbox']].map(([type,label]) => `<button data-add-field="${type}"><span>${fieldIcon(type)}</span>${label}</button>`).join('')}<button class="danger-button" id="deleteForm">Delete form</button></aside></div>`;
    } else if (activeFormTab === 'responses') {
      const responses = form.responses || [];
      root.innerHTML = `<div class="response-toolbar"><span>${responses.length} response${responses.length === 1 ? '' : 's'}</span><button class="secondary" id="exportFormResponses" ${responses.length ? '' : 'disabled'}>Export CSV</button></div>${responses.length ? `<div class="response-table-wrap"><table class="enterprise-table"><thead><tr><th>Submitted</th>${form.fields.map(field => `<th>${esc(field.label)}</th>`).join('')}<th></th></tr></thead><tbody>${responses.map(response => `<tr><td>${dateTime(response.submittedAt)}</td>${form.fields.map(field => `<td>${esc(response.values[field.id] ?? '')}</td>`).join('')}<td><button class="table-action" data-delete-response="${response.id}">×</button></td></tr>`).join('')}</tbody></table></div>` : empty('≡', 'No responses', 'Published form submissions will appear here.')}`;
    } else {
      const url = `${location.origin}${location.pathname}#/form/${form.slug}`;
      root.innerHTML = `<div class="share-panel"><div class="share-card glass"><span>Public link</span><div><input readonly value="${esc(url)}" id="formShareUrl"><button id="copyFormUrl">Copy</button></div></div><div class="share-card glass"><span>Status</span><strong>${esc(form.status || 'Draft')}</strong><p>${form.status === 'Published' ? 'Anyone with the link can submit a response.' : 'Publish the form before sharing it.'}</p></div><div class="share-card glass"><span>Embed</span><code>&lt;iframe src=&quot;${esc(url)}&quot;&gt;&lt;/iframe&gt;</code></div></div>`;
    }
    bindFormEditor(form);
  }

  function fieldIcon(type) { return ({ text:'T', textarea:'¶', email:'@', number:'#', date:'◇', select:'⌄', checkbox:'✓' })[type] || 'T'; }

  function fieldEditor(field, index, total) {
    return `<article class="builder-field glass" data-field-id="${field.id}"><header><span class="field-type">${fieldIcon(field.type)}</span><input value="${esc(field.label)}" data-field-label="${field.id}" aria-label="Field label"><div><button data-move-field="${field.id}:-1" ${index === 0 ? 'disabled' : ''}>↑</button><button data-move-field="${field.id}:1" ${index === total - 1 ? 'disabled' : ''}>↓</button><button data-remove-field="${field.id}">×</button></div></header><div class="field-options"><label><input type="checkbox" data-field-required="${field.id}" ${field.required ? 'checked' : ''}> Required</label>${field.type === 'select' ? `<label>Options<input value="${esc((field.options || []).join(', '))}" data-field-options="${field.id}" placeholder="Option one, Option two"></label>` : ''}</div></article>`;
  }

  function bindFormEditor(form) {
    $('#formName')?.addEventListener('change', event => { form.name = event.target.value.trim() || 'Untitled form'; save('form_updated'); });
    $('#formDescription')?.addEventListener('change', event => { form.description = event.target.value.trim(); save('form_updated'); });
    $$('[data-form-tab]').forEach(button => button.onclick = () => { activeFormTab = button.dataset.formTab; renderForms(); });
    $$('[data-add-field]').forEach(button => button.onclick = () => {
      const type = button.dataset.addField;
      form.fields.push({ id: uid('fld'), type, label: ({text:'Short answer',textarea:'Long answer',email:'Email address',number:'Number',date:'Date',select:'Select an option',checkbox:'Confirmation'})[type], required: false, options: type === 'select' ? ['Option one', 'Option two'] : [] });
      save('form_field_added');
    });
    $$('[data-field-label]').forEach(input => input.onchange = () => { const field = form.fields.find(item => item.id === input.dataset.fieldLabel); if (field) field.label = input.value.trim() || 'Untitled field'; save('form_field_updated'); });
    $$('[data-field-required]').forEach(input => input.onchange = () => { const field = form.fields.find(item => item.id === input.dataset.fieldRequired); if (field) field.required = input.checked; save('form_field_updated'); });
    $$('[data-field-options]').forEach(input => input.onchange = () => { const field = form.fields.find(item => item.id === input.dataset.fieldOptions); if (field) field.options = input.value.split(',').map(item => item.trim()).filter(Boolean); save('form_field_updated'); });
    $$('[data-remove-field]').forEach(button => button.onclick = () => { form.fields = form.fields.filter(item => item.id !== button.dataset.removeField); save('form_field_removed'); });
    $$('[data-move-field]').forEach(button => button.onclick = () => { const [id, raw] = button.dataset.moveField.split(':'); const from = form.fields.findIndex(item => item.id === id); const to = from + Number(raw); if (from < 0 || to < 0 || to >= form.fields.length) return; const [item] = form.fields.splice(from, 1); form.fields.splice(to, 0, item); save('form_field_moved'); });
    $('#publishForm')?.addEventListener('click', () => { form.status = form.status === 'Published' ? 'Draft' : 'Published'; save(form.status === 'Published' ? 'form_published' : 'form_unpublished'); toast(form.status); });
    $('#previewForm')?.addEventListener('click', () => openPublicForm(form, true));
    $('#deleteForm')?.addEventListener('click', () => { if (!confirm('Delete this form and all responses?')) return; state.forms = state.forms.filter(item => item.id !== form.id); activeFormId = state.forms[0]?.id || null; save('form_deleted'); });
    $('#exportFormResponses')?.addEventListener('click', () => exportFormResponses(form));
    $$('[data-delete-response]').forEach(button => button.onclick = () => { form.responses = form.responses.filter(item => item.id !== button.dataset.deleteResponse); save('form_response_deleted'); });
    $('#copyFormUrl')?.addEventListener('click', async () => { await navigator.clipboard?.writeText($('#formShareUrl').value); toast('Link copied'); });
  }

  function createForm() {
    const form = { id: uid('frm'), name: 'Untitled form', description: '', slug: uid('form').slice(5), status: 'Draft', fields: [], responses: [], createdAt: new Date().toISOString() };
    state.forms.unshift(form);
    activeFormId = form.id;
    activeFormTab = 'build';
    save('form_created');
  }

  function openPublicForm(form, preview = false) {
    if (!form || (!preview && form.status !== 'Published')) {
      openPublic(`<div class="public-form-shell">${empty('≡', 'Form unavailable', 'This form is not currently accepting responses.')}</div>`);
      return;
    }
    openPublic(`<div class="public-form-shell"><div class="public-form-card glass"><header><img src="./icon.svg" alt=""><span>${preview ? 'Preview' : 'Form'}</span></header><h1>${esc(form.name)}</h1>${form.description ? `<p>${esc(form.description)}</p>` : ''}<form id="publicFormSubmit">${form.fields.map(publicField).join('')}<button class="primary">Submit</button></form></div></div>`);
    $('#publicFormSubmit').onsubmit = event => {
      event.preventDefault();
      if (preview) { toast('Preview only'); return; }
      const data = new FormData(event.target);
      const values = {};
      form.fields.forEach(field => values[field.id] = field.type === 'checkbox' ? data.get(field.id) === 'on' : data.get(field.id));
      form.responses.push({ id: uid('rsp'), values, submittedAt: new Date().toISOString() });
      save('form_response_submitted');
      $('#enterprisePublicBody').innerHTML = `<div class="public-form-shell"><div class="public-form-card glass success-state"><span>✓</span><h1>Response received</h1><button class="secondary" id="publicDone">Done</button></div></div>`;
      $('#publicDone').onclick = closePublic;
    };
  }

  function publicField(field) {
    const required = field.required ? 'required' : '';
    const label = `<span>${esc(field.label)}${field.required ? ' *' : ''}</span>`;
    if (field.type === 'textarea') return `<label>${label}<textarea name="${field.id}" ${required}></textarea></label>`;
    if (field.type === 'select') return `<label>${label}<select name="${field.id}" ${required}><option value="">Select</option>${(field.options || []).map(option => `<option>${esc(option)}</option>`).join('')}</select></label>`;
    if (field.type === 'checkbox') return `<label class="public-checkbox"><input type="checkbox" name="${field.id}" ${required}>${label}</label>`;
    return `<label>${label}<input type="${field.type === 'text' ? 'text' : field.type}" name="${field.id}" ${required}></label>`;
  }

  function exportFormResponses(form) {
    const headers = ['Submitted', ...form.fields.map(field => field.label)];
    const rows = (form.responses || []).map(response => [response.submittedAt, ...form.fields.map(field => response.values[field.id] ?? '')]);
    downloadCsv(`${slug(form.name)}-responses.csv`, [headers, ...rows]);
  }

  function renderCareers() {
    const root = $('#careerContent');
    if (!root) return;
    $$('[data-career-tab]').forEach(button => button.classList.toggle('active', button.dataset.careerTab === activeCareerTab));
    if (activeCareerTab === 'openings') {
      root.innerHTML = state.jobs?.length ? `<div class="job-grid">${state.jobs.map(jobCard).join('')}</div>` : empty('◇', 'No openings', 'Create a role and publish it to the public careers page.');
    } else if (activeCareerTab === 'pipeline') {
      root.innerHTML = `<div class="pipeline-board">${STAGES.map(stage => pipelineColumn(stage)).join('')}</div>`;
    } else {
      const total = state.applications.length;
      const hired = state.applications.filter(item => item.status === 'Hired').length;
      const interviews = state.applications.filter(item => item.status === 'Interview').length;
      root.innerHTML = `<div class="analytics-kpis"><article class="glass"><small>Applications</small><strong>${total}</strong></article><article class="glass"><small>Interviews</small><strong>${interviews}</strong></article><article class="glass"><small>Hires</small><strong>${hired}</strong></article><article class="glass"><small>Hire rate</small><strong>${total ? Math.round(hired / total * 100) : 0}%</strong></article></div><div class="glass chart-panel"><header><h2>Applications by stage</h2></header>${horizontalBars(STAGES.map(stage => [stage, state.applications.filter(item => item.status === stage).length]))}</div>`;
    }
    bindCareers();
  }

  function jobCard(job) {
    const count = state.applications.filter(item => item.jobId === job.id).length;
    return `<article class="glass job-card"><header><span class="status-pill ${String(job.status).toLowerCase()}">${esc(job.status)}</span><button data-delete-job="${job.id}">×</button></header><h2>${esc(job.title)}</h2><p>${esc(job.department || '')}${job.location ? ` · ${esc(job.location)}` : ''}</p><div class="job-meta"><span>${esc(job.type || 'Full-time')}</span><span>${count} applicant${count === 1 ? '' : 's'}</span></div><footer><button class="secondary" data-preview-job="${job.id}">Preview</button><button class="secondary" data-edit-job="${job.id}">Edit</button><button class="primary" data-toggle-job="${job.id}">${job.status === 'Published' ? 'Unpublish' : 'Publish'}</button></footer></article>`;
  }

  function pipelineColumn(stage) {
    const items = state.applications.filter(item => item.status === stage);
    return `<section class="glass pipeline-column"><header><h3>${stage}</h3><b>${items.length}</b></header><div>${items.length ? items.map(applicationCard).join('') : '<p class="pipeline-empty">Empty</p>'}</div></section>`;
  }

  function applicationCard(item) {
    return `<button class="candidate-card" data-application-id="${item.id}"><b>${esc(item.name)}</b><small>${esc(item.jobTitle || '')}</small><span>${dateText(item.createdAt)}</span></button>`;
  }

  function bindCareers() {
    $$('[data-career-tab]').forEach(button => button.onclick = () => { activeCareerTab = button.dataset.careerTab; renderCareers(); });
    $$('[data-toggle-job]').forEach(button => button.onclick = () => { const job = state.jobs.find(item => item.id === button.dataset.toggleJob); if (!job) return; job.status = job.status === 'Published' ? 'Draft' : 'Published'; save(job.status === 'Published' ? 'job_published' : 'job_unpublished'); });
    $$('[data-preview-job]').forEach(button => button.onclick = () => openJob(state.jobs.find(item => item.id === button.dataset.previewJob), true));
    $$('[data-edit-job]').forEach(button => button.onclick = () => openJobEditor(state.jobs.find(item => item.id === button.dataset.editJob)));
    $$('[data-delete-job]').forEach(button => button.onclick = () => { if (!confirm('Delete this opening?')) return; state.jobs = state.jobs.filter(item => item.id !== button.dataset.deleteJob); save('job_deleted'); });
    $$('[data-application-id]').forEach(button => button.onclick = () => openApplication(button.dataset.applicationId));
  }

  function openJobEditor(job = null) {
    const item = job || { id: uid('job'), title:'', department:'', location:'', type:'Full-time', description:'', requirements:'', status:'Draft', createdAt:new Date().toISOString() };
    openModal(job ? 'Edit opening' : 'New opening', `<form id="jobEditorForm" class="enterprise-form"><div class="form-grid"><label>Title<input name="title" value="${esc(item.title)}" required></label><label>Department<input name="department" value="${esc(item.department)}"></label><label>Location<input name="location" value="${esc(item.location)}"></label><label>Employment type<select name="type">${['Full-time','Part-time','Contract','Internship','Temporary'].map(value => `<option ${item.type === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label></div><label>Description<textarea name="description" required>${esc(item.description)}</textarea></label><label>Requirements<textarea name="requirements">${esc(item.requirements)}</textarea></label><button class="primary">Save opening</button></form>`, () => {
      $('#jobEditorForm').onsubmit = event => {
        event.preventDefault();
        Object.assign(item, Object.fromEntries(new FormData(event.target)));
        if (!job) state.jobs.unshift(item);
        save(job ? 'job_updated' : 'job_created');
        closeModal();
      };
    });
  }

  function openJob(job, preview = false) {
    if (!job || (!preview && job.status !== 'Published')) {
      openPublic(`<div class="public-job-shell">${empty('◇', 'Opening unavailable')}</div>`);
      return;
    }
    openPublic(`<div class="public-job-shell"><article class="public-job glass"><header><span>${esc(job.department || 'Careers')}</span><span>${esc(job.location || '')}</span></header><h1>${esc(job.title)}</h1><div class="public-job-meta"><span>${esc(job.type || 'Full-time')}</span><span>${esc(job.location || '')}</span></div><section><h2>About the role</h2><p>${esc(job.description || '').replace(/\n/g, '<br>')}</p></section>${job.requirements ? `<section><h2>Requirements</h2><p>${esc(job.requirements).replace(/\n/g, '<br>')}</p></section>` : ''}<button class="primary" id="applyJob">Apply</button></article></div>`);
    $('#applyJob').onclick = () => openApplicationForm(job, preview);
  }

  function openApplicationForm(job, preview = false) {
    openPublic(`<div class="public-job-shell"><article class="public-job glass"><header><button class="back-link" id="applicationBack">← Back</button><span>${esc(job.title)}</span></header><h1>Apply</h1><form id="jobApplicationForm" class="enterprise-form"><div class="form-grid"><label>Full name<input name="name" required></label><label>Email<input name="email" type="email" required></label><label>Phone<input name="phone" type="tel"></label><label>Location<input name="location"></label><label>LinkedIn<input name="linkedin" type="url"></label><label>Portfolio<input name="portfolio" type="url"></label></div><label>Resume<input name="resume" type="file" accept=".pdf,.doc,.docx"></label><label>Cover letter<textarea name="cover"></textarea></label><label class="public-checkbox"><input type="checkbox" name="consent" required><span>I consent to the processing of this application.</span></label><button class="primary">Submit application</button></form></article></div>`);
    $('#applicationBack').onclick = () => openJob(job, preview);
    $('#jobApplicationForm').onsubmit = event => {
      event.preventDefault();
      if (preview) { toast('Preview only'); return; }
      const data = new FormData(event.target);
      const resume = event.target.elements.resume.files[0];
      state.applications.unshift({ id:uid('app'), jobId:job.id, jobTitle:job.title, name:data.get('name'), email:data.get('email'), phone:data.get('phone'), location:data.get('location'), linkedin:data.get('linkedin'), portfolio:data.get('portfolio'), cover:data.get('cover'), resumeName:resume?.name || '', resumeSize:resume?.size || 0, status:'New', createdAt:new Date().toISOString(), notes:[] });
      save('job_application_submitted');
      $('#enterprisePublicBody').innerHTML = `<div class="public-job-shell"><article class="public-job glass success-state"><span>✓</span><h1>Application received</h1><p>Your application reference is ${esc(state.applications[0].id.toUpperCase())}.</p><button class="secondary" id="applicationDone">Done</button></article></div>`;
      $('#applicationDone').onclick = closePublic;
    };
  }

  function openApplication(id) {
    const item = state.applications.find(application => application.id === id);
    if (!item) return;
    openModal(item.name, `<div class="candidate-detail"><div class="candidate-summary"><span class="candidate-avatar">${esc(initials(item.name))}</span><div><h3>${esc(item.name)}</h3><p>${esc(item.jobTitle)}</p></div></div><div class="detail-grid"><div><small>Email</small><b>${esc(item.email)}</b></div><div><small>Phone</small><b>${esc(item.phone || '')}</b></div><div><small>Location</small><b>${esc(item.location || '')}</b></div><div><small>Resume</small><b>${esc(item.resumeName || 'Not attached')}</b></div></div><label>Stage<select id="applicationStage">${STAGES.map(stage => `<option ${item.status === stage ? 'selected' : ''}>${stage}</option>`).join('')}</select></label>${item.cover ? `<section><h3>Cover letter</h3><p>${esc(item.cover).replace(/\n/g, '<br>')}</p></section>` : ''}<form id="candidateNoteForm"><label>Add note<textarea name="note" required></textarea></label><button class="secondary">Add note</button></form><div class="candidate-notes">${(item.notes || []).map(note => `<article><p>${esc(note.text)}</p><small>${dateTime(note.at)}</small></article>`).join('')}</div><button class="danger-button" id="deleteApplication">Delete application</button></div>`, () => {
      $('#applicationStage').onchange = event => { item.status = event.target.value; save('application_stage_changed'); };
      $('#candidateNoteForm').onsubmit = event => { event.preventDefault(); const text = new FormData(event.target).get('note').trim(); if (!text) return; item.notes.unshift({ id:uid('note'), text, at:new Date().toISOString() }); save('application_note_added'); openApplication(item.id); };
      $('#deleteApplication').onclick = () => { if (!confirm('Delete this application?')) return; state.applications = state.applications.filter(application => application.id !== item.id); save('application_deleted'); closeModal(); };
    });
  }

  function renderApplications() {
    const root = $('#applicationsContent');
    if (!root) return;
    root.innerHTML = state.applications.length ? `<div class="application-toolbar glass"><div><strong>${state.applications.length}</strong><span>Total applications</span></div>${STAGES.map(stage => `<button data-application-filter="${stage}">${stage} <b>${state.applications.filter(item => item.status === stage).length}</b></button>`).join('')}</div><div class="response-table-wrap"><table class="enterprise-table"><thead><tr><th>Candidate</th><th>Opening</th><th>Stage</th><th>Applied</th><th></th></tr></thead><tbody>${state.applications.map(item => `<tr><td><b>${esc(item.name)}</b><small>${esc(item.email)}</small></td><td>${esc(item.jobTitle)}</td><td><span class="status-pill ${item.status.toLowerCase()}">${item.status}</span></td><td>${dateText(item.createdAt)}</td><td><button class="table-action" data-application-id="${item.id}">Open</button></td></tr>`).join('')}</tbody></table></div>` : empty('▤', 'No applications', 'Published job applications will appear here.');
    $$('[data-application-id]').forEach(button => button.onclick = () => openApplication(button.dataset.applicationId));
  }

  function renderAllResponses() {
    const root = $('#allResponsesContent');
    if (!root) return;
    const responses = state.forms.flatMap(form => (form.responses || []).map(response => ({ ...response, formId:form.id, formName:form.name })));
    root.innerHTML = responses.length ? `<div class="analytics-kpis"><article class="glass"><small>Forms</small><strong>${state.forms.length}</strong></article><article class="glass"><small>Published</small><strong>${state.forms.filter(item => item.status === 'Published').length}</strong></article><article class="glass"><small>Responses</small><strong>${responses.length}</strong></article><article class="glass"><small>Average</small><strong>${state.forms.length ? (responses.length / state.forms.length).toFixed(1) : '0'}</strong></article></div><div class="response-table-wrap"><table class="enterprise-table"><thead><tr><th>Form</th><th>Submitted</th><th>Response ID</th><th></th></tr></thead><tbody>${responses.map(item => `<tr><td>${esc(item.formName)}</td><td>${dateTime(item.submittedAt)}</td><td>${esc(item.id)}</td><td><button class="table-action" data-open-form-response="${item.formId}:${item.id}">Open</button></td></tr>`).join('')}</tbody></table></div>` : empty('≡', 'No responses');
    $$('[data-open-form-response]').forEach(button => button.onclick = () => { const [formId] = button.dataset.openFormResponse.split(':'); activeFormId = formId; activeFormTab = 'responses'; activateExistingView('forms'); });
  }

  function activateExistingView(view) {
    const button = $(`.nav-target[data-view="${view}"]`);
    if (button) button.click();
    else {
      $$('.view').forEach(node => node.classList.toggle('active', node.id === `view-${view}`));
      if ($('#viewTitle')) $('#viewTitle').textContent = view[0].toUpperCase() + view.slice(1);
      history.pushState(null, '', `#/${view}`);
    }
    renderAll();
  }

  let crmTab = 'pipeline';
  function renderCrm() {
    const root = $('#crmContent'); if (!root) return;
    $$('[data-crm-tab]').forEach(button => button.classList.toggle('active', button.dataset.crmTab === crmTab));
    if (crmTab === 'pipeline') root.innerHTML = `<div class="pipeline-board crm-pipeline">${DEAL_STAGES.map(stage => dealColumn(stage)).join('')}</div>`;
    if (crmTab === 'companies') root.innerHTML = state.companies.length ? `<div class="record-grid cards">${state.companies.map(item => `<article class="glass record-card"><header><h2>${esc(item.name)}</h2><button data-enterprise-delete="companies:${item.id}">×</button></header><p>${esc(item.domain || '')}</p><span class="badge">${esc(item.industry || '')}</span></article>`).join('')}</div>` : empty('◎','No companies');
    if (crmTab === 'contacts') root.innerHTML = state.contacts.length ? `<div class="record-grid cards">${state.contacts.map(item => `<article class="glass record-card"><header><h2>${esc(item.name)}</h2><button data-enterprise-delete="contacts:${item.id}">×</button></header><p>${esc(item.email || '')}</p><span class="badge">${esc(item.company || '')}</span></article>`).join('')}</div>` : empty('◎','No contacts');
    bindEnterpriseDynamic();
  }

  function dealColumn(stage) {
    const items = state.deals.filter(item => item.stage === stage);
    return `<section class="glass pipeline-column"><header><h3>${stage}</h3><b>${money(items.reduce((sum,item) => sum + Number(item.value || 0), 0))}</b></header><div>${items.length ? items.map(item => `<button class="deal-card" data-edit-deal="${item.id}"><b>${esc(item.name)}</b><span>${money(item.value)}</span><small>${esc(item.company || '')}</small></button>`).join('') : '<p class="pipeline-empty">Empty</p>'}</div></section>`;
  }

  let financeTab = 'overview';
  function renderFinance() {
    const root = $('#financeContent'); if (!root) return;
    $$('[data-finance-tab]').forEach(button => button.classList.toggle('active', button.dataset.financeTab === financeTab));
    const paid = state.invoices.filter(item => item.status === 'Paid').reduce((sum,item) => sum + Number(item.amount || 0), 0);
    const due = state.invoices.filter(item => item.status !== 'Paid').reduce((sum,item) => sum + Number(item.amount || 0), 0);
    const expenses = state.expenses.reduce((sum,item) => sum + Number(item.amount || 0), 0);
    if (financeTab === 'overview') root.innerHTML = `<div class="analytics-kpis"><article class="glass"><small>Revenue received</small><strong>${money(paid)}</strong></article><article class="glass"><small>Outstanding</small><strong>${money(due)}</strong></article><article class="glass"><small>Expenses</small><strong>${money(expenses)}</strong></article><article class="glass"><small>Net</small><strong>${money(paid-expenses)}</strong></article></div><div class="finance-grid"><div class="glass chart-panel"><header><h2>Cash activity</h2></header>${financeChart()}</div><div class="glass chart-panel"><header><h2>Expense categories</h2></header>${horizontalBars(groupAmounts(state.expenses,'category'))}</div></div>`;
    if (financeTab === 'invoices') root.innerHTML = dataTable(state.invoices, [['number','Invoice'],['client','Client'],['amount','Amount'],['status','Status'],['due','Due']], 'invoices');
    if (financeTab === 'expenses') root.innerHTML = dataTable(state.expenses, [['merchant','Merchant'],['category','Category'],['amount','Amount'],['status','Status'],['date','Date']], 'expenses');
    if (financeTab === 'budgets') root.innerHTML = state.budgets.length ? `<div class="record-grid cards">${state.budgets.map(item => `<article class="glass record-card"><header><h2>${esc(item.name)}</h2><button data-enterprise-delete="budgets:${item.id}">×</button></header><strong>${money(item.amount)}</strong><p>${esc(item.period || '')}</p></article>`).join('')}</div>` : `<div class="toolbar-empty"><button class="primary" data-enterprise-create="budget">New budget</button>${empty('$','No budgets')}</div>`;
    bindEnterpriseDynamic();
  }

  let peopleTab = 'onboarding';
  function renderPeopleOps() {
    const root = $('#peopleOpsContent'); if (!root) return;
    $$('[data-people-tab]').forEach(button => button.classList.toggle('active', button.dataset.peopleTab === peopleTab));
    if (peopleTab === 'onboarding') root.innerHTML = state.onboarding.length ? `<div class="onboarding-grid">${state.onboarding.map(item => `<article class="glass onboarding-card"><header><span class="candidate-avatar">${initials(item.name)}</span><div><h2>${esc(item.name)}</h2><p>${esc(item.role || '')}</p></div><button data-enterprise-delete="onboarding:${item.id}">×</button></header><div class="checklist">${(item.steps || []).map((step,index) => `<label><input type="checkbox" data-onboarding-step="${item.id}:${index}" ${step.done?'checked':''}><span>${esc(step.label)}</span></label>`).join('')}</div><footer><span>${Math.round(((item.steps || []).filter(step=>step.done).length / Math.max(1,(item.steps || []).length))*100)}%</span><div><i style="width:${Math.round(((item.steps || []).filter(step=>step.done).length / Math.max(1,(item.steps || []).length))*100)}%"></i></div></footer></article>`).join('')}</div>` : empty('◇','No onboarding plans');
    if (peopleTab === 'reviews') root.innerHTML = dataTable(state.reviews,[['person','Person'],['cycle','Cycle'],['status','Status'],['due','Due']],'reviews');
    if (peopleTab === 'goals') root.innerHTML = state.goals.length ? `<div class="record-grid cards">${state.goals.map(item=>`<article class="glass record-card"><header><h2>${esc(item.title)}</h2><button data-enterprise-delete="goals:${item.id}">×</button></header><p>${esc(item.owner || '')}</p><div class="goal-progress"><i style="width:${Math.max(0,Math.min(100,Number(item.progress||0)))}%"></i></div><span class="badge">${Number(item.progress||0)}%</span></article>`).join('')}</div>` : empty('◇','No goals');
    bindEnterpriseDynamic();
  }

  let vendorTab = 'vendors';
  function renderVendors() {
    const root = $('#vendorsContent'); if (!root) return;
    $$('[data-vendor-tab]').forEach(button => button.classList.toggle('active', button.dataset.vendorTab === vendorTab));
    if (vendorTab === 'vendors') root.innerHTML = state.vendors.length ? `<div class="record-grid cards">${state.vendors.map(item=>`<article class="glass record-card"><header><h2>${esc(item.name)}</h2><button data-enterprise-delete="vendors:${item.id}">×</button></header><p>${esc(item.category || '')}</p><span class="badge">${esc(item.status || 'Active')}</span></article>`).join('')}</div>` : empty('⌘','No vendors');
    else root.innerHTML = dataTable(state.contracts,[['name','Contract'],['vendor','Vendor'],['value','Value'],['status','Status'],['renewal','Renewal']],'contracts');
    bindEnterpriseDynamic();
  }

  let growthTab = 'campaigns';
  function renderMarketing() {
    const root = $('#marketingContent'); if (!root) return;
    $$('[data-growth-tab]').forEach(button => button.classList.toggle('active', button.dataset.growthTab === growthTab));
    if (growthTab === 'campaigns') root.innerHTML = state.campaigns.length ? `<div class="record-grid cards">${state.campaigns.map(item=>`<article class="glass record-card"><header><h2>${esc(item.name)}</h2><button data-enterprise-delete="campaigns:${item.id}">×</button></header><p>${esc(item.channel || '')}</p><span class="badge">${esc(item.status || 'Draft')}</span><small>${money(item.budget || 0)}</small></article>`).join('')}</div>` : empty('↗','No campaigns');
    else root.innerHTML = dataTable(state.leads,[['name','Lead'],['company','Company'],['source','Source'],['status','Status'],['createdAt','Created']],'leads');
    bindEnterpriseDynamic();
  }

  function dataTable(items, columns, key) {
    if (!items.length) return empty('▤',`No ${key}`);
    return `<div class="response-table-wrap"><table class="enterprise-table"><thead><tr>${columns.map(([,label])=>`<th>${label}</th>`).join('')}<th></th></tr></thead><tbody>${items.map(item=>`<tr>${columns.map(([field])=>`<td>${formatCell(field,item[field])}</td>`).join('')}<td><button class="table-action" data-enterprise-delete="${key}:${item.id}">×</button></td></tr>`).join('')}</tbody></table></div>`;
  }

  function formatCell(field,value) {
    if (['amount','value'].includes(field)) return money(value);
    if (['date','due','renewal','createdAt'].includes(field)) return dateText(value);
    if (field === 'status') return `<span class="status-pill ${String(value||'').toLowerCase().replace(/\s+/g,'-')}">${esc(value||'')}</span>`;
    return esc(value || '');
  }

  function renderExecutive() {
    const root = $('#executiveDashboard'); if (!root) return;
    const ws = workspaceState();
    const paid = state.invoices.filter(item=>item.status==='Paid').reduce((sum,item)=>sum+Number(item.amount||0),0);
    const expenses = state.expenses.reduce((sum,item)=>sum+Number(item.amount||0),0);
    const pipeline = state.deals.filter(item=>!['Won','Lost'].includes(item.stage)).reduce((sum,item)=>sum+Number(item.value||0),0);
    const openRequests = (ws.requests||[]).filter(item=>!['Resolved','Closed','Approved'].includes(item.status)).length;
    root.innerHTML = `<div class="executive-hero glass"><div><small>Executive overview</small><h2>${money(paid-expenses)}</h2><p>Net recorded cash activity</p></div><div class="executive-score"><span>${healthScore()}%</span><small>Operating readiness</small></div></div><div class="analytics-kpis executive-kpis"><article class="glass"><small>Pipeline</small><strong>${money(pipeline)}</strong><span>${state.deals.length} deals</span></article><article class="glass"><small>Applications</small><strong>${state.applications.length}</strong><span>${state.jobs.filter(item=>item.status==='Published').length} published roles</span></article><article class="glass"><small>Form responses</small><strong>${responseCount()}</strong><span>${state.forms.filter(item=>item.status==='Published').length} published forms</span></article><article class="glass"><small>Requests</small><strong>${openRequests}</strong><span>open requests</span></article></div><div class="executive-grid"><article class="glass chart-panel"><header><h2>Activity</h2><span>30 days</span></header>${activityChart(30)}</article><article class="glass executive-list"><header><h2>Attention</h2></header>${attentionList(ws)}</article><article class="glass chart-panel"><header><h2>Hiring funnel</h2></header>${horizontalBars(STAGES.map(stage=>[stage,state.applications.filter(item=>item.status===stage).length]))}</article><article class="glass chart-panel"><header><h2>Revenue pipeline</h2></header>${horizontalBars(DEAL_STAGES.map(stage=>[stage,state.deals.filter(item=>item.stage===stage).reduce((sum,item)=>sum+Number(item.value||0),0)]),true)}</article></div>`;
  }

  function healthScore() {
    const checks = [state.forms.some(item=>item.status==='Published'),state.jobs.some(item=>item.status==='Published'),state.companies.length>0,state.deals.length>0,state.invoices.length>0,state.onboarding.length>0,state.vendors.length>0,state.campaigns.length>0];
    return Math.round(checks.filter(Boolean).length/checks.length*100);
  }

  function attentionList(ws) {
    const items=[];
    const overdueInvoices=state.invoices.filter(item=>item.status!=='Paid'&&item.due&&new Date(item.due)<new Date());
    if(overdueInvoices.length)items.push([`${overdueInvoices.length} overdue invoice${overdueInvoices.length===1?'':'s'}`,'finance']);
    const pendingApprovals=(ws.approvals||[]).filter(item=>(item.status||'Pending')==='Pending').length;
    if(pendingApprovals)items.push([`${pendingApprovals} pending approval${pendingApprovals===1?'':'s'}`,'approvals']);
    const openRequests=(ws.requests||[]).filter(item=>!['Resolved','Closed','Approved'].includes(item.status)).length;
    if(openRequests)items.push([`${openRequests} open request${openRequests===1?'':'s'}`,'requests']);
    const screening=state.applications.filter(item=>['New','Screening'].includes(item.status)).length;
    if(screening)items.push([`${screening} candidate${screening===1?'':'s'} need review`,'applications']);
    return items.length?items.map(([label,view])=>`<button ${view==='applications'?`class="enterprise-nav" data-enterprise-view="applications"`:`data-existing-view="${view}"`}><span>${esc(label)}</span><b>→</b></button>`).join(''):empty('✓','Nothing requires attention');
  }

  function renderAnalytics() {
    const root=$('#enterpriseAnalytics'); if(!root)return;
    $$('[data-analytics-tab]').forEach(button=>button.classList.toggle('active',button.dataset.analyticsTab===activeAnalyticsTab));
    const ws=workspaceState();
    const rangeEvents=filteredEvents();
    const kpis={responses:responseCount(analyticsRange),applications:filteredItems(state.applications,'createdAt').length,leads:filteredItems(state.leads,'createdAt').length,requests:filteredItems(ws.requests||[],'createdAt').length,expenses:filteredItems(state.expenses,'date').reduce((s,i)=>s+Number(i.amount||0),0),revenue:filteredItems(state.invoices.filter(i=>i.status==='Paid'),'paidAt').reduce((s,i)=>s+Number(i.amount||0),0)};
    if(activeAnalyticsTab==='overview')root.innerHTML=`<div class="analytics-kpis"><article class="glass"><small>Form responses</small><strong>${kpis.responses}</strong></article><article class="glass"><small>Applications</small><strong>${kpis.applications}</strong></article><article class="glass"><small>Leads</small><strong>${kpis.leads}</strong></article><article class="glass"><small>Requests</small><strong>${kpis.requests}</strong></article><article class="glass"><small>Revenue</small><strong>${money(kpis.revenue)}</strong></article><article class="glass"><small>Expenses</small><strong>${money(kpis.expenses)}</strong></article></div><div class="analytics-layout"><article class="glass chart-panel wide"><header><h2>Activity trend</h2></header>${activityChart(analyticsRange||3650)}</article><article class="glass chart-panel"><header><h2>Activity mix</h2></header>${donutChart(groupEvents(rangeEvents))}</article></div>`;
    if(activeAnalyticsTab==='growth')root.innerHTML=`<div class="analytics-kpis"><article class="glass"><small>Leads</small><strong>${kpis.leads}</strong></article><article class="glass"><small>Deals</small><strong>${filteredItems(state.deals,'createdAt').length}</strong></article><article class="glass"><small>Pipeline</small><strong>${money(state.deals.filter(i=>!['Won','Lost'].includes(i.stage)).reduce((s,i)=>s+Number(i.value||0),0))}</strong></article><article class="glass"><small>Won</small><strong>${money(state.deals.filter(i=>i.stage==='Won').reduce((s,i)=>s+Number(i.value||0),0))}</strong></article></div><div class="analytics-layout"><article class="glass chart-panel"><header><h2>Deal stages</h2></header>${horizontalBars(DEAL_STAGES.map(stage=>[stage,state.deals.filter(i=>i.stage===stage).length]))}</article><article class="glass chart-panel"><header><h2>Lead sources</h2></header>${horizontalBars(groupCounts(state.leads,'source'))}</article></div>`;
    if(activeAnalyticsTab==='people')root.innerHTML=`<div class="analytics-kpis"><article class="glass"><small>People</small><strong>${(ws.people||[]).length}</strong></article><article class="glass"><small>Applications</small><strong>${state.applications.length}</strong></article><article class="glass"><small>In onboarding</small><strong>${state.onboarding.length}</strong></article><article class="glass"><small>Goals</small><strong>${state.goals.length}</strong></article></div><div class="analytics-layout"><article class="glass chart-panel"><header><h2>Hiring funnel</h2></header>${horizontalBars(STAGES.map(stage=>[stage,state.applications.filter(i=>i.status===stage).length]))}</article><article class="glass chart-panel"><header><h2>Applications by role</h2></header>${horizontalBars(groupCounts(state.applications,'jobTitle'))}</article></div>`;
    if(activeAnalyticsTab==='operations')root.innerHTML=`<div class="analytics-kpis"><article class="glass"><small>Requests</small><strong>${(ws.requests||[]).length}</strong></article><article class="glass"><small>Assets</small><strong>${(ws.assets||[]).length}</strong></article><article class="glass"><small>Vendors</small><strong>${state.vendors.length}</strong></article><article class="glass"><small>Contracts</small><strong>${state.contracts.length}</strong></article></div><div class="analytics-layout"><article class="glass chart-panel"><header><h2>Expense categories</h2></header>${horizontalBars(groupAmounts(filteredItems(state.expenses,'date'),'category'),true)}</article><article class="glass chart-panel"><header><h2>Request status</h2></header>${horizontalBars(groupCounts(ws.requests||[],'status'))}</article></div>`;
  }

  function filteredItems(items,field){if(!analyticsRange)return items;const min=Date.now()-analyticsRange*86400000;return items.filter(item=>{const value=item[field]||item.createdAt;return value&&new Date(value).getTime()>=min})}
  function filteredEvents(){return filteredItems(state.events,'at')}
  function responseCount(range=0){const items=state.forms.flatMap(form=>form.responses||[]);return range?items.filter(item=>new Date(item.submittedAt)>=new Date(Date.now()-range*86400000)).length:items.length}
  function groupCounts(items,field){const map={};items.forEach(item=>{const key=item[field]||'Unspecified';map[key]=(map[key]||0)+1});return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,8)}
  function groupAmounts(items,field){const map={};items.forEach(item=>{const key=item[field]||'Unspecified';map[key]=(map[key]||0)+Number(item.amount||item.value||0)});return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,8)}
  function groupEvents(events){const map={};events.forEach(item=>{const key=String(item.type||'activity').split('_')[0];map[key]=(map[key]||0)+1});return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,6)}

  function horizontalBars(items,currency=false){if(!items.length||!items.some(([,v])=>Number(v)>0))return empty('⌇','No data');const max=Math.max(...items.map(([,v])=>Number(v)||0),1);return `<div class="horizontal-bars">${items.map(([label,value])=>`<div><span>${esc(label)}</span><i><b style="width:${Math.round(Number(value||0)/max*100)}%"></b></i><strong>${currency?money(value):Number(value||0).toLocaleString()}</strong></div>`).join('')}</div>`}
  function donutChart(items){if(!items.length)return empty('○','No data');const total=items.reduce((s,[,v])=>s+v,0);let offset=0;const segments=items.map(([label,value],index)=>{const pct=value/total*100;const start=offset;offset+=pct;return `${palette(index)} ${start}% ${offset}%`});return `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${segments.join(',')})"><span>${total}</span></div><div class="donut-legend">${items.map(([label,value],index)=>`<div><i style="background:${palette(index)}"></i><span>${esc(label)}</span><b>${value}</b></div>`).join('')}</div></div>`}
  function palette(index){return ['#9b0017','#71000f','#c12a3d','#4e0009','#d6cfc7','#575157'][index%6]}
  function activityChart(days){const count=Math.min(days||30,90);const points=[];for(let i=count-1;i>=0;i--){const day=new Date();day.setHours(0,0,0,0);day.setDate(day.getDate()-i);const next=new Date(day);next.setDate(next.getDate()+1);const value=state.events.filter(event=>{const time=new Date(event.at);return time>=day&&time<next}).length+state.applications.filter(item=>{const time=new Date(item.createdAt);return time>=day&&time<next}).length+state.forms.reduce((sum,form)=>sum+(form.responses||[]).filter(item=>{const time=new Date(item.submittedAt);return time>=day&&time<next}).length,0);points.push({date:day,value})}return svgLine(points)}
  function financeChart(){const points=[];for(let i=29;i>=0;i--){const day=new Date();day.setHours(0,0,0,0);day.setDate(day.getDate()-i);const next=new Date(day);next.setDate(next.getDate()+1);const revenue=state.invoices.filter(item=>item.status==='Paid'&&item.paidAt&&new Date(item.paidAt)>=day&&new Date(item.paidAt)<next).reduce((s,i)=>s+Number(i.amount||0),0);const expense=state.expenses.filter(item=>item.date&&new Date(item.date)>=day&&new Date(item.date)<next).reduce((s,i)=>s+Number(i.amount||0),0);points.push({date:day,value:revenue-expense})}return svgLine(points,true)}
  function svgLine(points,currency=false){const width=720,height=250,pad=28;const values=points.map(p=>p.value);const min=Math.min(0,...values),max=Math.max(1,...values);const span=max-min||1;const coords=points.map((p,index)=>[pad+(index/Math.max(1,points.length-1))*(width-pad*2),height-pad-((p.value-min)/span)*(height-pad*2)]);const path=coords.map((c,index)=>`${index?'L':'M'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');return `<div class="line-chart"><svg viewBox="0 0 ${width} ${height}" role="img"><defs><linearGradient id="enterpriseArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8e0013" stop-opacity=".45"/><stop offset="1" stop-color="#8e0013" stop-opacity="0"/></linearGradient></defs><path class="chart-area" d="${path} L${coords.at(-1)?.[0]||pad},${height-pad} L${coords[0]?.[0]||pad},${height-pad} Z"/><path class="chart-line" d="${path}"/></svg><footer><span>${dateText(points[0]?.date)}</span><b>${currency?money(values.reduce((s,v)=>s+v,0)):values.reduce((s,v)=>s+v,0)} total</b><span>${dateText(points.at(-1)?.date)}</span></footer></div>`}

  function openCreate(type, existing = null) {
    const configs = {
      company:{title:'New company',fields:[['name','Company','text'],['domain','Domain','text'],['industry','Industry','text']]},
      contact:{title:'New contact',fields:[['name','Name','text'],['email','Email','email'],['company','Company','text']]},
      deal:{title:existing?'Edit deal':'New deal',fields:[['name','Deal','text'],['company','Company','text'],['value','Value','number'],['stage','Stage','select',DEAL_STAGES]]},
      invoice:{title:'New invoice',fields:[['number','Invoice number','text'],['client','Client','text'],['amount','Amount','number'],['due','Due date','date'],['status','Status','select',['Draft','Sent','Due','Paid','Void']]]},
      expense:{title:'New expense',fields:[['merchant','Merchant','text'],['category','Category','text'],['amount','Amount','number'],['date','Date','date'],['status','Status','select',['Draft','Submitted','Approved','Paid','Rejected']]]},
      budget:{title:'New budget',fields:[['name','Budget','text'],['amount','Amount','number'],['period','Period','text']]},
      onboarding:{title:'Start onboarding',fields:[['name','Person','text'],['role','Role','text'],['start','Start date','date']]},
      review:{title:'New review',fields:[['person','Person','text'],['cycle','Cycle','text'],['due','Due date','date'],['status','Status','select',['Draft','Open','Submitted','Complete']]]},
      goal:{title:'New goal',fields:[['title','Goal','text'],['owner','Owner','text'],['progress','Progress %','number']]},
      vendor:{title:'New vendor',fields:[['name','Vendor','text'],['category','Category','text'],['status','Status','select',['Prospect','Active','Paused','Offboarded']]]},
      contract:{title:'New contract',fields:[['name','Contract','text'],['vendor','Vendor','text'],['value','Value','number'],['renewal','Renewal date','date'],['status','Status','select',['Draft','Review','Active','Expired','Terminated']]]},
      campaign:{title:'New campaign',fields:[['name','Campaign','text'],['channel','Channel','text'],['budget','Budget','number'],['status','Status','select',['Draft','Scheduled','Active','Paused','Complete']]]},
      lead:{title:'New lead',fields:[['name','Name','text'],['company','Company','text'],['source','Source','text'],['status','Status','select',['New','Contacted','Qualified','Converted','Disqualified']]]}
    };
    const config=configs[type];if(!config)return;
    const item=existing||{};
    openModal(config.title,`<form id="enterpriseCreateForm" class="enterprise-form"><div class="form-grid">${config.fields.map(([name,label,input,options])=>fieldMarkup(name,label,input,options,item[name])).join('')}</div><button class="primary">Save</button></form>`,()=>{$('#enterpriseCreateForm').onsubmit=event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.target));Object.assign(item,data,{id:item.id||uid(type.slice(0,3)),createdAt:item.createdAt||new Date().toISOString()});if(['value','amount','budget','progress'].some(key=>key in item))['value','amount','budget','progress'].forEach(key=>{if(key in item)item[key]=Number(item[key]||0)});if(type==='invoice'&&item.status==='Paid'&&!item.paidAt)item.paidAt=new Date().toISOString();if(type==='onboarding'){item.steps=[{label:'Account setup',done:false},{label:'Equipment',done:false},{label:'Introductions',done:false},{label:'Required documents',done:false},{label:'First-week plan',done:false}]}
      const target=({company:'companies',contact:'contacts',deal:'deals',invoice:'invoices',expense:'expenses',budget:'budgets',onboarding:'onboarding',review:'reviews',goal:'goals',vendor:'vendors',contract:'contracts',campaign:'campaigns',lead:'leads'})[type];if(!existing)state[target].unshift(item);save(`${type}_${existing?'updated':'created'}`);closeModal();};});
  }
  function fieldMarkup(name,label,type,options,value=''){if(type==='select')return`<label>${label}<select name="${name}">${options.map(option=>`<option ${value===option?'selected':''}>${option}</option>`).join('')}</select></label>`;return`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${['name','title','number','client','merchant','person'].includes(name)?'required':''}></label>`}

  function bindEnterpriseDynamic() {
    $$('[data-enterprise-delete]').forEach(button=>button.onclick=()=>{const[key,id]=button.dataset.enterpriseDelete.split(':');if(!state[key])return;state[key]=state[key].filter(item=>item.id!==id);save(`${key}_deleted`)});
    $$('[data-edit-deal]').forEach(button=>button.onclick=()=>openCreate('deal',state.deals.find(item=>item.id===button.dataset.editDeal)));
    $$('[data-onboarding-step]').forEach(input=>input.onchange=()=>{const[id,index]=input.dataset.onboardingStep.split(':');const plan=state.onboarding.find(item=>item.id===id);if(plan?.steps[index])plan.steps[index].done=input.checked;save('onboarding_step_updated')});
  }

  function renderAll() {
    renderForms();renderCareers();renderApplications();renderAllResponses();renderCrm();renderFinance();renderPeopleOps();renderVendors();renderMarketing();renderExecutive();renderAnalytics();
    if($('#homeDealCount'))$('#homeDealCount').textContent=state.deals.length;
    if($('#homeInvoiceCount'))$('#homeInvoiceCount').textContent=state.invoices.length;
    if($('#homeApplicantCount'))$('#homeApplicantCount').textContent=state.applications.length;
  }

  function bind() {
    document.addEventListener('click', event => {
      const nav=event.target.closest('[data-enterprise-view]');if(nav){event.preventDefault();enterpriseShow(nav.dataset.enterpriseView);return}
      const create=event.target.closest('[data-enterprise-create]');if(create){openCreate(create.dataset.enterpriseCreate);return}
      const existing=event.target.closest('[data-existing-view]');if(existing){activateExistingView(existing.dataset.existingView);return}
      const support=event.target.closest('[data-open-public-support]');if(support){window.SENSE_COMPANY?.openPublic?.('support');return}
    });
    $('#newEnterpriseForm').onclick=createForm;
    $('#formSearch').oninput=renderForms;
    $('#newEnterpriseJob').onclick=()=>openJobEditor();
    $('#openPublicCareers').onclick=()=>openPublicCareers();
    $('#applicationsExport').onclick=exportApplications;
    $('#analyticsExport').onclick=exportAnalytics;
    $('#executiveExport').onclick=exportExecutive;
    $('#analyticsRange').onchange=event=>{analyticsRange=Number(event.target.value);renderAnalytics()};
    $$('[data-analytics-tab]').forEach(button=>button.onclick=()=>{activeAnalyticsTab=button.dataset.analyticsTab;renderAnalytics()});
    $$('[data-crm-tab]').forEach(button=>button.onclick=()=>{crmTab=button.dataset.crmTab;renderCrm()});
    $$('[data-finance-tab]').forEach(button=>button.onclick=()=>{financeTab=button.dataset.financeTab;renderFinance()});
    $$('[data-people-tab]').forEach(button=>button.onclick=()=>{peopleTab=button.dataset.peopleTab;renderPeopleOps()});
    $$('[data-vendor-tab]').forEach(button=>button.onclick=()=>{vendorTab=button.dataset.vendorTab;renderVendors()});
    $$('[data-growth-tab]').forEach(button=>button.onclick=()=>{growthTab=button.dataset.growthTab;renderMarketing()});
    window.addEventListener('hashchange',routeFromHash);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!$('#enterpriseModal').classList.contains('hidden'))closeModal();else if(!$('#enterprisePublic').classList.contains('hidden'))closePublic()}});
  }

  function routeFromHash(){const match=location.hash.match(/^#\/(executive|crm|finance|peopleops|vendors|marketing|applications|formresponses)$/);if(match&&!$('#app').classList.contains('hidden'))enterpriseShow(match[1],true);const form=location.hash.match(/^#\/form\/([^/]+)$/);if(form){const item=state.forms.find(entry=>entry.slug===form[1]);openPublicForm(item,false)}const job=location.hash.match(/^#\/jobs\/([^/]+)$/);if(job){openJob(state.jobs.find(entry=>entry.id===job[1]),false)}}

  function openPublicCareers(){const published=state.jobs.filter(item=>item.status==='Published');openPublic(`<div class="public-careers-shell"><header><small>Careers</small><h1>Open roles</h1></header>${published.length?`<div class="public-jobs-list">${published.map(job=>`<button data-public-job="${job.id}"><span><b>${esc(job.title)}</b><small>${esc(job.department||'')}${job.location?` · ${esc(job.location)}`:''}</small></span><i>→</i></button>`).join('')}</div>`:empty('◇','No open roles')}</div>`);$$('[data-public-job]').forEach(button=>button.onclick=()=>{history.pushState(null,'',`#/jobs/${button.dataset.publicJob}`);openJob(state.jobs.find(item=>item.id===button.dataset.publicJob),false)})}

  function syncPublicCareers(){const main=$('#publicSiteMain');if(!main)return;const heading=main.querySelector('h1')?.textContent?.trim();if(heading!=='Careers')return;if($('#enterpriseCareersPublic'))return;const published=state.jobs.filter(item=>item.status==='Published');main.insertAdjacentHTML('beforeend',`<section id="enterpriseCareersPublic" class="public-enterprise-section"><header><h2>Open roles</h2></header>${published.length?`<div class="public-jobs-list">${published.map(job=>`<button data-public-job="${job.id}"><span><b>${esc(job.title)}</b><small>${esc(job.department||'')}${job.location?` · ${esc(job.location)}`:''}</small></span><i>→</i></button>`).join('')}</div>`:empty('◇','No open roles')}</section>`);$$('[data-public-job]').forEach(button=>button.onclick=()=>{history.pushState(null,'',`#/jobs/${button.dataset.publicJob}`);openJob(state.jobs.find(item=>item.id===button.dataset.publicJob),false)})}

  function observePublic(){const target=$('#publicSiteMain');if(!target)return;new MutationObserver(()=>syncPublicCareers()).observe(target,{childList:true,subtree:true})}

  function exportApplications(){downloadCsv('applications.csv',[['Application ID','Name','Email','Role','Stage','Applied'],...state.applications.map(item=>[item.id,item.name,item.email,item.jobTitle,item.status,item.createdAt])])}
  function exportAnalytics(){downloadJson('analytics-export.json',{generatedAt:new Date().toISOString(),rangeDays:analyticsRange,metrics:{forms:state.forms.length,responses:responseCount(),applications:state.applications.length,deals:state.deals.length,invoices:state.invoices.length,expenses:state.expenses.length},events:filteredEvents()})}
  function exportExecutive(){downloadJson('executive-report.json',{generatedAt:new Date().toISOString(),healthScore:healthScore(),pipeline:state.deals.reduce((s,i)=>s+Number(i.value||0),0),applications:state.applications.length,responses:responseCount(),finance:{invoices:state.invoices,expenses:state.expenses}})}
  function downloadCsv(filename,rows){const text=rows.map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\n');download(filename,text,'text/csv')}
  function downloadJson(filename,value){download(filename,JSON.stringify(value,null,2),'application/json')}
  function download(filename,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function slug(value){return String(value||'export').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'export'}
  function initials(value){return String(value||'?').split(/\s+/).slice(0,2).map(item=>item[0]).join('').toUpperCase()}

  function boot() {
    if (booted) return;
    const ready = $('#workspace') && $('#view-forms') && $('#view-careers') && $('#view-analytics');
    if (!ready) { setTimeout(boot, 80); return; }
    booted = true;
    injectShell();injectViews();upgradeFormsPage();upgradeCareersPage();upgradeAnalyticsPage();bind();observePublic();renderAll();routeFromHash();
    window.SENSE_ENTERPRISE={
      version:VERSION,
      state,
      exportState:()=>clone(state),
      importState:value=>{
        if(!value||typeof value!=='object')return;
        Object.keys(state).forEach(key=>delete state[key]);
        Object.assign(state,clone(EMPTY),value,{settings:{...EMPTY.settings,...(value.settings||{})}});
        localStorage.setItem(STORE,JSON.stringify(state));
        renderAll();
      },
      open:enterpriseShow,
      openCareers:openPublicCareers,
      openForm:slugValue=>openPublicForm(state.forms.find(item=>item.slug===slugValue),false)
    };
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
