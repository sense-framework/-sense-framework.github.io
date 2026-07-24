(() => {
  'use strict';

  const VERSION = '0.2.1';
  const STORE_KEY = 'sense.romeo.sessions.v1';
  const ENDPOINT_KEY = 'sense.romeo.endpoint';
  const API_KEY = 'sense.romeo.apiKey';
  const INSTRUCTIONS_KEY = 'sense.romeo.instructions';
  const SKILLS_KEY = 'sense.romeo.skills';
  const MEMORY_KEY = 'sense.romeo.memoryEnabled';
  const MODES = {
    collective: {
      label: 'Collective',
      description: 'GPT plans, Claude and Grok analyze in parallel, GPT synthesizes.'
    },
    deep: {
      label: 'Deep',
      description: 'Collective analysis, specialist critique, then GPT revision.'
    },
    gpt_only: {
      label: 'GPT only',
      description: 'GPT handles the task without specialist calls.'
    }
  };

  const state = {
    open: false,
    endpoint: localStorage.getItem(ENDPOINT_KEY) || '',
    apiKey: sessionStorage.getItem(API_KEY) || '',
    instructions: localStorage.getItem(INSTRUCTIONS_KEY) || '',
    memoryEnabled: localStorage.getItem(MEMORY_KEY) !== 'false',
    skills: JSON.parse(localStorage.getItem(SKILLS_KEY) || '["research","planning"]'),
    sessions: loadSessions(),
    activeId: null,
    mode: 'collective',
    health: null,
    sending: false,
    lastHash: location.hash
  };

  function uid() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
  }

  function loadSessions() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveSessions() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.sessions.slice(0, 30)));
  }

  function activeSession() {
    return state.sessions.find(session => session.id === state.activeId) || null;
  }

  function newSession() {
    const session = {
      id: uid(),
      title: 'New Romeo session',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      remoteSessionId: null,
      mode: state.mode,
      messages: [],
      runs: []
    };
    state.sessions.unshift(session);
    state.activeId = session.id;
    saveSessions();
    renderSessions();
    renderConversation();
    return session;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'\"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;'
    })[character]);
  }

  function fmtTime(value) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      }).format(new Date(value));
    } catch {
      return '';
    }
  }

  function injectStyles() {
    if (document.getElementById('romeoStyles')) return;
    const style = document.createElement('style');
    style.id = 'romeoStyles';
    style.textContent = `
      :root{--romeo-red:#e3132c;--romeo-red2:#ff3048;--romeo-bg:#050505;--romeo-panel:#101012;--romeo-panel2:#17171a;--romeo-text:#f7f5f2;--romeo-muted:#969295;--romeo-line:rgba(255,255,255,.1);--romeo-safe-t:env(safe-area-inset-top,0px);--romeo-safe-b:env(safe-area-inset-bottom,0px)}
      .romeo-launcher{position:fixed;z-index:2147483000;right:18px;bottom:calc(18px + env(safe-area-inset-bottom,0px));width:58px;height:58px;border:1px solid rgba(227,19,44,.58);border-radius:19px;background:linear-gradient(145deg,#1a080b,#0b0b0c);color:#fff;box-shadow:0 18px 50px rgba(0,0,0,.58),0 0 28px rgba(227,19,44,.18);display:grid;place-items:center;cursor:pointer;font:900 16px/1 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.06em;-webkit-tap-highlight-color:transparent}
      .romeo-launcher:before{content:"";position:absolute;inset:8px;border:1px solid rgba(255,255,255,.14);border-radius:14px;transform:rotate(45deg)}
      .romeo-launcher span{position:relative}.romeo-launcher:hover{transform:translateY(-2px);border-color:var(--romeo-red2)}
      .romeo-shell{position:fixed;z-index:2147483640;inset:0;background:radial-gradient(circle at 78% 12%,rgba(150,0,24,.2),transparent 32rem),linear-gradient(145deg,#050505,#0a090a 55%,#060606);color:var(--romeo-text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:none;overflow:hidden;color-scheme:dark}
      .romeo-shell.open{display:grid;grid-template-columns:300px minmax(0,1fr) 330px;grid-template-rows:74px minmax(0,1fr)}
      .romeo-shell *{box-sizing:border-box}.romeo-shell button,.romeo-shell input,.romeo-shell textarea,.romeo-shell select{font:inherit;color:inherit}.romeo-shell button{-webkit-tap-highlight-color:transparent}
      .romeo-top{grid-column:1/-1;display:flex;align-items:center;gap:16px;padding:0 20px;border-bottom:1px solid var(--romeo-line);background:rgba(5,5,6,.84);backdrop-filter:blur(22px);padding-top:var(--romeo-safe-t);min-height:calc(74px + var(--romeo-safe-t))}
      .romeo-back,.romeo-icon-btn{width:42px;height:42px;border:1px solid var(--romeo-line);border-radius:14px;background:#101012;display:grid;place-items:center;cursor:pointer}.romeo-back:hover,.romeo-icon-btn:hover{border-color:rgba(227,19,44,.5);background:#17090c}
      .romeo-mark{width:42px;height:42px;border:1px solid rgba(227,19,44,.55);border-radius:14px;display:grid;place-items:center;font-weight:950;box-shadow:0 0 24px rgba(227,19,44,.12)}
      .romeo-brand{display:grid;gap:2px;min-width:0}.romeo-brand strong{letter-spacing:.16em}.romeo-brand small{color:var(--romeo-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .romeo-status{margin-left:auto;display:flex;align-items:center;gap:8px;color:var(--romeo-muted);font-size:.75rem}.romeo-status i{width:8px;height:8px;border-radius:50%;background:#777}.romeo-status.online i{background:#36cf83;box-shadow:0 0 13px #36cf83}.romeo-status.degraded i{background:#f1a43b}.romeo-status.offline i{background:var(--romeo-red2)}
      .romeo-sidebar{grid-column:1;grid-row:2;border-right:1px solid var(--romeo-line);background:rgba(8,8,9,.8);display:flex;flex-direction:column;min-height:0}.romeo-sidebar-head{padding:18px;display:flex;gap:10px}.romeo-new{flex:1;border:1px solid rgba(227,19,44,.45);border-radius:14px;background:rgba(227,19,44,.1);padding:12px;font-weight:800;cursor:pointer}.romeo-session-list{overflow:auto;padding:0 10px 18px}.romeo-session{width:100%;border:1px solid transparent;border-radius:15px;background:transparent;padding:13px;text-align:left;cursor:pointer;margin-bottom:6px}.romeo-session:hover,.romeo-session.active{background:rgba(227,19,44,.09);border-color:rgba(227,19,44,.2)}.romeo-session strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.romeo-session small{display:block;color:var(--romeo-muted);margin-top:5px}.romeo-sidebar-foot{margin-top:auto;padding:14px;border-top:1px solid var(--romeo-line);color:var(--romeo-muted);font-size:.72rem;line-height:1.45}
      .romeo-main{grid-column:2;grid-row:2;display:flex;flex-direction:column;min-width:0;min-height:0}.romeo-modebar{display:flex;align-items:center;gap:8px;padding:13px 18px;border-bottom:1px solid var(--romeo-line);overflow:auto}.romeo-mode{border:1px solid var(--romeo-line);border-radius:999px;background:#111114;padding:8px 12px;cursor:pointer;white-space:nowrap;font-size:.78rem}.romeo-mode.active{border-color:rgba(227,19,44,.55);background:rgba(227,19,44,.12)}.romeo-context-chip{margin-left:auto;color:var(--romeo-muted);font-size:.72rem;white-space:nowrap}
      .romeo-thread{flex:1;overflow:auto;padding:28px clamp(18px,5vw,70px);scroll-behavior:smooth}.romeo-empty{min-height:100%;display:grid;place-content:center;text-align:center;gap:16px}.romeo-orbit{width:148px;aspect-ratio:1;margin:auto;border:1px solid rgba(227,19,44,.28);border-radius:50%;position:relative;display:grid;place-items:center}.romeo-orbit:before,.romeo-orbit:after{content:"";position:absolute;border-radius:50%;border:1px solid var(--romeo-line);inset:15%}.romeo-orbit:after{inset:33%;border-color:rgba(227,19,44,.46)}.romeo-orbit b{font-size:2.7rem;letter-spacing:.08em}.romeo-empty h1{margin:0;font-size:clamp(2.6rem,7vw,5.8rem);letter-spacing:-.06em}.romeo-empty p{max-width:620px;margin:0 auto;color:var(--romeo-muted);line-height:1.6}.romeo-suggestions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;max-width:720px;margin:auto}.romeo-suggestion{border:1px solid var(--romeo-line);border-radius:999px;background:#111114;padding:9px 13px;cursor:pointer;font-size:.78rem}.romeo-suggestion:hover{border-color:rgba(227,19,44,.45)}
      .romeo-message{display:grid;grid-template-columns:44px minmax(0,1fr);gap:14px;margin:0 auto 24px;max-width:900px}.romeo-message.user{grid-template-columns:minmax(0,1fr) 44px}.romeo-message.user .romeo-avatar{grid-column:2}.romeo-message.user .romeo-message-body{grid-column:1;grid-row:1;text-align:right}.romeo-avatar{width:42px;height:42px;border:1px solid rgba(227,19,44,.35);border-radius:14px;background:rgba(227,19,44,.09);display:grid;place-items:center;font-weight:900}.romeo-message.user .romeo-avatar{border-color:var(--romeo-line);background:#161619}.romeo-message-meta{display:flex;align-items:center;gap:8px;color:var(--romeo-muted);font-size:.72rem;margin-bottom:7px}.romeo-message.user .romeo-message-meta{justify-content:flex-end}.romeo-bubble{display:inline-block;max-width:100%;text-align:left;white-space:pre-wrap;line-height:1.62;border:1px solid var(--romeo-line);border-radius:18px;background:#111114;padding:15px 17px;box-shadow:0 16px 45px rgba(0,0,0,.16)}.romeo-message.user .romeo-bubble{background:rgba(227,19,44,.13);border-color:rgba(227,19,44,.28)}.romeo-run{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.romeo-run span,.romeo-run button{border:1px solid var(--romeo-line);border-radius:999px;background:#0d0d0f;padding:6px 9px;color:var(--romeo-muted);font-size:.68rem}.romeo-run button{cursor:pointer}.romeo-run button:hover{color:#fff;border-color:rgba(227,19,44,.45)}
      .romeo-compose{padding:14px 18px calc(14px + var(--romeo-safe-b));border-top:1px solid var(--romeo-line);background:rgba(7,7,8,.86);backdrop-filter:blur(22px)}.romeo-compose-box{max-width:960px;margin:auto;border:1px solid var(--romeo-line);border-radius:21px;background:#0f0f11;padding:10px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:end}.romeo-compose textarea{width:100%;min-height:48px;max-height:170px;resize:none;border:0;outline:0;background:transparent;padding:12px;color:#fff;line-height:1.45}.romeo-send{width:48px;height:48px;border:0;border-radius:16px;background:var(--romeo-red);font-weight:950;cursor:pointer}.romeo-send:disabled{opacity:.45;cursor:wait}.romeo-compose-note{max-width:960px;margin:7px auto 0;color:var(--romeo-muted);font-size:.68rem;text-align:center}
      .romeo-inspector{grid-column:3;grid-row:2;border-left:1px solid var(--romeo-line);background:rgba(9,9,10,.76);overflow:auto;padding:18px}.romeo-card{border:1px solid var(--romeo-line);border-radius:18px;background:rgba(17,17,19,.86);padding:17px;margin-bottom:12px}.romeo-card h3{margin:0 0 12px;font-size:.83rem;letter-spacing:.08em}.romeo-card p{color:var(--romeo-muted);font-size:.76rem;line-height:1.5}.romeo-provider{display:grid;grid-template-columns:9px 1fr auto;gap:9px;align-items:center;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:.75rem}.romeo-provider:last-child{border-bottom:0}.romeo-provider i{width:8px;height:8px;border-radius:50%;background:#777}.romeo-provider.ok i{background:#36cf83}.romeo-provider.error i{background:var(--romeo-red2)}.romeo-provider small{color:var(--romeo-muted)}
      .romeo-field{display:grid;gap:7px;margin:12px 0}.romeo-field label{color:var(--romeo-muted);font-size:.68rem;text-transform:uppercase;letter-spacing:.09em}.romeo-field input,.romeo-field textarea{width:100%;border:1px solid var(--romeo-line);border-radius:13px;background:#09090a;padding:11px;outline:0}.romeo-field textarea{min-height:90px;resize:vertical}.romeo-save{width:100%;border:1px solid rgba(227,19,44,.46);border-radius:13px;background:rgba(227,19,44,.1);padding:11px;font-weight:800;cursor:pointer}.romeo-switch{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;color:var(--romeo-muted);font-size:.75rem}.romeo-switch input{accent-color:var(--romeo-red)}.romeo-skills{display:flex;flex-wrap:wrap;gap:7px}.romeo-skill{border:1px solid var(--romeo-line);border-radius:999px;background:#0d0d0f;padding:7px 9px;cursor:pointer;color:var(--romeo-muted);font-size:.69rem}.romeo-skill.active{border-color:rgba(227,19,44,.48);background:rgba(227,19,44,.11);color:#fff}.romeo-toast{position:fixed;z-index:2147483647;right:18px;bottom:18px;max-width:360px;border:1px solid rgba(227,19,44,.45);border-radius:14px;background:#19090d;color:#fff;padding:12px 15px;box-shadow:0 18px 60px #000;opacity:0;transform:translateY(8px);pointer-events:none;transition:.22s}.romeo-toast.show{opacity:1;transform:none}
      @media(max-width:1100px){.romeo-shell.open{grid-template-columns:270px minmax(0,1fr)}.romeo-inspector{display:none}}
      @media(max-width:760px){.romeo-launcher{right:12px;bottom:calc(82px + env(safe-area-inset-bottom,0px));width:52px;height:52px;border-radius:17px}.romeo-shell.open{grid-template-columns:1fr;grid-template-rows:calc(58px + var(--romeo-safe-t)) minmax(0,1fr)}.romeo-top{min-height:calc(58px + var(--romeo-safe-t));padding:var(--romeo-safe-t) 12px 0;gap:10px}.romeo-top .romeo-icon-btn{display:none}.romeo-sidebar{display:none}.romeo-main{grid-column:1;grid-row:2}.romeo-brand strong{font-size:.84rem}.romeo-brand small{font-size:.66rem}.romeo-status span{display:none}.romeo-modebar{padding:10px 12px}.romeo-context-chip{display:none}.romeo-thread{padding:20px 13px}.romeo-empty{align-content:start;padding-top:11vh}.romeo-orbit{width:112px}.romeo-empty h1{font-size:3.5rem}.romeo-empty p{font-size:.84rem}.romeo-message{grid-template-columns:36px minmax(0,1fr);gap:9px;margin-bottom:19px}.romeo-message.user{grid-template-columns:minmax(0,1fr) 36px}.romeo-avatar{width:34px;height:34px;border-radius:11px;font-size:.75rem}.romeo-bubble{padding:12px 14px;border-radius:15px;font-size:.9rem}.romeo-compose{padding:10px 10px calc(10px + var(--romeo-safe-b))}.romeo-compose-box{border-radius:18px}.romeo-compose textarea{padding:9px;min-height:44px}.romeo-send{width:44px;height:44px;border-radius:14px}.romeo-compose-note{font-size:.61rem}.romeo-mobile-menu{display:grid!important}.romeo-back{width:38px;height:38px;border-radius:12px}}
      @media(min-width:761px){.romeo-mobile-menu{display:none!important}}
    `;
    document.head.appendChild(style);
  }

  function buildUi() {
    if (document.getElementById('romeoShell')) return;

    const launcher = document.createElement('button');
    launcher.className = 'romeo-launcher';
    launcher.id = 'romeoLauncher';
    launcher.type = 'button';
    launcher.setAttribute('aria-label', 'Open Romeo');
    launcher.innerHTML = '<span>R</span>';

    const shell = document.createElement('section');
    shell.className = 'romeo-shell';
    shell.id = 'romeoShell';
    shell.setAttribute('aria-hidden', 'true');
    shell.innerHTML = `
      <header class="romeo-top">
        <button class="romeo-back" id="romeoClose" type="button" aria-label="Return to SenseOS">←</button>
        <div class="romeo-mark">R</div>
        <div class="romeo-brand"><strong>ROMEO</strong><small>Multi-model intelligence for SenseOS</small></div>
        <div class="romeo-status offline" id="romeoStatus"><i></i><span>Local preview</span></div>
        <button class="romeo-icon-btn romeo-mobile-menu" id="romeoSessionsButton" type="button" aria-label="Sessions">☰</button>
        <button class="romeo-icon-btn" id="romeoSettingsButton" type="button" aria-label="Romeo settings">⚙</button>
      </header>
      <aside class="romeo-sidebar" id="romeoSidebar">
        <div class="romeo-sidebar-head"><button class="romeo-new" id="romeoNew" type="button">＋ New session</button></div>
        <div class="romeo-session-list" id="romeoSessions"></div>
        <div class="romeo-sidebar-foot">Session continuity is preserved locally now and by Romeo's MongoDB memory when the service is connected.</div>
      </aside>
      <main class="romeo-main">
        <div class="romeo-modebar" id="romeoModes">
          ${Object.entries(MODES).map(([key, mode]) => `<button class="romeo-mode${key === state.mode ? ' active' : ''}" data-mode="${key}" type="button">${mode.label}</button>`).join('')}
          <span class="romeo-context-chip" id="romeoModeDescription">${MODES[state.mode].description}</span>
        </div>
        <div class="romeo-thread" id="romeoThread"></div>
        <form class="romeo-compose" id="romeoCompose">
          <div class="romeo-compose-box"><textarea id="romeoPrompt" rows="1" maxlength="100000" placeholder="Ask Romeo to think, research, plan, build, review, or coordinate…"></textarea><button class="romeo-send" id="romeoSend" type="submit" aria-label="Send">↑</button></div>
          <div class="romeo-compose-note">Romeo returns one synthesized answer with contributor provenance. Hidden chain-of-thought is not requested or displayed.</div>
        </form>
      </main>
      <aside class="romeo-inspector" id="romeoInspector">
        <div class="romeo-card"><h3>CONTRIBUTORS</h3><div id="romeoProviders"><div class="romeo-provider"><i></i><span>GPT coordinator</span><small>standby</small></div><div class="romeo-provider"><i></i><span>Claude specialist</span><small>standby</small></div><div class="romeo-provider"><i></i><span>Grok specialist</span><small>standby</small></div></div></div>
        <div class="romeo-card"><h3>CONTEXT</h3><div class="romeo-switch"><span>Session memory</span><input id="romeoMemory" type="checkbox" ${state.memoryEnabled ? 'checked' : ''}></div><div class="romeo-field"><label for="romeoInstructions">Custom instructions</label><textarea id="romeoInstructions" placeholder="How Romeo should work with you…">${escapeHtml(state.instructions)}</textarea></div><div class="romeo-field"><label>Skills</label><div class="romeo-skills" id="romeoSkills"></div></div><button class="romeo-save" id="romeoSaveContext" type="button">Save context</button></div>
        <div class="romeo-card" id="romeoConnectionCard"><h3>CONNECTION</h3><p>Connect to the deployed Project Romeo FastAPI service. The provider keys remain on Romeo's backend.</p><div class="romeo-field"><label for="romeoEndpoint">Romeo API URL</label><input id="romeoEndpoint" type="url" placeholder="https://romeo.example.com" value="${escapeHtml(state.endpoint)}"></div><div class="romeo-field"><label for="romeoApiKey">Romeo access key</label><input id="romeoApiKey" type="password" placeholder="Session only" value="${escapeHtml(state.apiKey)}"></div><button class="romeo-save" id="romeoConnect" type="button">Connect and test</button></div>
        <div class="romeo-card"><h3>LAST RUN</h3><div id="romeoReceipt"><p>No run receipt yet.</p></div></div>
      </aside>
      <div class="romeo-toast" id="romeoToast"></div>
    `;

    document.body.append(launcher, shell);
    renderSkills();
    wireEvents();
    if (!state.sessions.length) newSession();
    else {
      state.activeId = state.sessions[0].id;
      renderSessions();
      renderConversation();
    }

    if (location.hash === '#/romeo') openRomeo(false);
    if (state.endpoint) checkHealth();
  }

  function wireEvents() {
    document.getElementById('romeoLauncher').addEventListener('click', () => openRomeo(true));
    document.getElementById('romeoClose').addEventListener('click', closeRomeo);
    document.getElementById('romeoNew').addEventListener('click', newSession);
    document.getElementById('romeoCompose').addEventListener('submit', sendMessage);
    document.getElementById('romeoSettingsButton').addEventListener('click', () => {
      const card = document.getElementById('romeoConnectionCard');
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.getElementById('romeoConnect').addEventListener('click', saveConnection);
    document.getElementById('romeoSaveContext').addEventListener('click', saveContext);
    document.getElementById('romeoMemory').addEventListener('change', event => {
      state.memoryEnabled = event.target.checked;
      localStorage.setItem(MEMORY_KEY, String(state.memoryEnabled));
    });
    document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
      state.mode = button.dataset.mode;
      document.querySelectorAll('[data-mode]').forEach(item => item.classList.toggle('active', item === button));
      document.getElementById('romeoModeDescription').textContent = MODES[state.mode].description;
      const session = activeSession();
      if (session) {
        session.mode = state.mode;
        saveSessions();
      }
    }));
    document.getElementById('romeoPrompt').addEventListener('input', event => {
      event.target.style.height = 'auto';
      event.target.style.height = `${Math.min(event.target.scrollHeight, 170)}px`;
    });
    document.getElementById('romeoPrompt').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        document.getElementById('romeoCompose').requestSubmit();
      }
    });
    document.getElementById('romeoSessionsButton').addEventListener('click', () => toast('Session list is available on larger screens. Use New session to start fresh.'));
    window.addEventListener('hashchange', () => {
      if (location.hash === '#/romeo' && !state.open) openRomeo(false);
      else if (state.open && location.hash !== '#/romeo') closeRomeo(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.open) closeRomeo();
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        openRomeo(true);
      }
    });
  }

  function renderSkills() {
    const skills = ['research', 'planning', 'code', 'review', 'creative', 'operations'];
    const root = document.getElementById('romeoSkills');
    root.innerHTML = skills.map(skill => `<button class="romeo-skill${state.skills.includes(skill) ? ' active' : ''}" data-skill="${skill}" type="button">${skill}</button>`).join('');
    root.querySelectorAll('[data-skill]').forEach(button => button.addEventListener('click', () => {
      const skill = button.dataset.skill;
      state.skills = state.skills.includes(skill) ? state.skills.filter(item => item !== skill) : [...state.skills, skill];
      button.classList.toggle('active');
    }));
  }

  function renderSessions() {
    const root = document.getElementById('romeoSessions');
    if (!root) return;
    root.innerHTML = state.sessions.map(session => `<button class="romeo-session${session.id === state.activeId ? ' active' : ''}" data-session-id="${session.id}" type="button"><strong>${escapeHtml(session.title)}</strong><small>${escapeHtml(MODES[session.mode]?.label || 'Collective')} · ${fmtTime(session.updatedAt)}</small></button>`).join('');
    root.querySelectorAll('[data-session-id]').forEach(button => button.addEventListener('click', () => {
      state.activeId = button.dataset.sessionId;
      const session = activeSession();
      state.mode = session?.mode || 'collective';
      document.querySelectorAll('[data-mode]').forEach(item => item.classList.toggle('active', item.dataset.mode === state.mode));
      document.getElementById('romeoModeDescription').textContent = MODES[state.mode].description;
      renderSessions();
      renderConversation();
    }));
  }

  function renderConversation() {
    const root = document.getElementById('romeoThread');
    const session = activeSession();
    if (!root || !session) return;
    if (!session.messages.length) {
      root.innerHTML = `<div class="romeo-empty"><div class="romeo-orbit"><b>R</b></div><h1>Romeo</h1><p>One interface for GPT-led planning, Claude and Grok specialist analysis, durable session memory, and a single synthesized answer.</p><div class="romeo-suggestions"><button class="romeo-suggestion" type="button">Plan the next SenseOS release</button><button class="romeo-suggestion" type="button">Review a technical architecture</button><button class="romeo-suggestion" type="button">Research and compare approaches</button><button class="romeo-suggestion" type="button">Turn an idea into an execution plan</button></div></div>`;
      root.querySelectorAll('.romeo-suggestion').forEach(button => button.addEventListener('click', () => {
        const input = document.getElementById('romeoPrompt');
        input.value = button.textContent;
        input.focus();
      }));
      renderReceipt();
      return;
    }
    root.innerHTML = session.messages.map(message => {
      const run = message.run;
      const contributorMarkup = run?.contributors?.length ? run.contributors.map(item => `<span>${escapeHtml(item.provider)} · ${escapeHtml(item.status)}</span>`).join('') : '';
      return `<article class="romeo-message ${message.role === 'user' ? 'user' : 'assistant'}"><div class="romeo-avatar">${message.role === 'user' ? 'ME' : 'R'}</div><div class="romeo-message-body"><div class="romeo-message-meta"><strong>${message.role === 'user' ? 'You' : 'Romeo'}</strong><span>${fmtTime(message.createdAt)}</span></div><div class="romeo-bubble">${escapeHtml(message.content)}</div>${run ? `<div class="romeo-run"><span>${escapeHtml(MODES[run.mode]?.label || run.mode)}</span>${contributorMarkup}<button type="button" data-trace="${escapeHtml(run.traceId || '')}">Receipt ${escapeHtml((run.traceId || 'local').slice(0, 8))}</button></div>` : ''}</div></article>`;
    }).join('');
    root.querySelectorAll('[data-trace]').forEach(button => button.addEventListener('click', () => showRun(button.dataset.trace)));
    root.scrollTop = root.scrollHeight;
    renderReceipt();
  }

  function renderProviders(contributors = []) {
    const providers = [
      ['openai', 'GPT coordinator'],
      ['anthropic', 'Claude specialist'],
      ['xai', 'Grok specialist']
    ];
    const root = document.getElementById('romeoProviders');
    root.innerHTML = providers.map(([provider, label]) => {
      const hits = contributors.filter(item => item.provider === provider);
      const last = hits[hits.length - 1];
      const status = last?.status || (state.health ? 'standby' : 'offline');
      const duration = hits.length ? `${hits.reduce((sum, item) => sum + Number(item.duration_ms || 0), 0)} ms` : status;
      return `<div class="romeo-provider ${last?.status === 'ok' ? 'ok' : last?.status === 'error' ? 'error' : ''}"><i></i><span>${label}</span><small>${escapeHtml(duration)}</small></div>`;
    }).join('');
  }

  function renderReceipt(runOverride = null) {
    const session = activeSession();
    const run = runOverride || session?.runs?.[0];
    const root = document.getElementById('romeoReceipt');
    if (!root) return;
    if (!run) {
      root.innerHTML = '<p>No run receipt yet.</p>';
      renderProviders([]);
      return;
    }
    root.innerHTML = `<p><strong>${escapeHtml(MODES[run.mode]?.label || run.mode)}</strong><br>Trace: ${escapeHtml(run.traceId || 'local-preview')}<br>Session: ${escapeHtml(run.remoteSessionId || session?.remoteSessionId || 'local')}<br>${fmtTime(run.createdAt)}</p>`;
    renderProviders(run.contributors || []);
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (state.sending) return;
    const input = document.getElementById('romeoPrompt');
    const prompt = input.value.trim();
    if (!prompt) return;
    let session = activeSession() || newSession();
    if (!session.messages.length) session.title = prompt.length > 52 ? `${prompt.slice(0, 52)}…` : prompt;
    session.mode = state.mode;
    session.updatedAt = new Date().toISOString();
    session.messages.push({ role: 'user', content: prompt, createdAt: new Date().toISOString() });
    input.value = '';
    input.style.height = 'auto';
    state.sending = true;
    document.getElementById('romeoSend').disabled = true;
    saveSessions();
    renderSessions();
    renderConversation();
    appendThinking();

    try {
      const result = state.endpoint && state.apiKey ? await callRomeo(prompt, session) : await localPreview(prompt, session);
      session = activeSession() || session;
      session.remoteSessionId = result.session_id || session.remoteSessionId;
      const run = {
        traceId: result.trace_id || `local-${uid()}`,
        remoteSessionId: result.session_id || session.remoteSessionId,
        mode: result.mode || state.mode,
        contributors: result.contributors || [],
        createdAt: result.created_at || new Date().toISOString()
      };
      session.runs.unshift(run);
      session.messages.push({ role: 'assistant', content: result.answer, createdAt: run.createdAt, run });
      session.updatedAt = new Date().toISOString();
      saveSessions();
      removeThinking();
      renderSessions();
      renderConversation();
    } catch (error) {
      removeThinking();
      session.messages.push({ role: 'assistant', content: `Romeo could not complete the run. ${error.message}`, createdAt: new Date().toISOString() });
      saveSessions();
      renderConversation();
      toast(error.message || 'Romeo request failed');
    } finally {
      state.sending = false;
      document.getElementById('romeoSend').disabled = false;
    }
  }

  function appendThinking() {
    const root = document.getElementById('romeoThread');
    const node = document.createElement('article');
    node.className = 'romeo-message assistant';
    node.id = 'romeoThinking';
    node.innerHTML = '<div class="romeo-avatar">R</div><div class="romeo-message-body"><div class="romeo-message-meta"><strong>Romeo</strong><span>orchestrating</span></div><div class="romeo-bubble">Planning and coordinating contributors…</div></div>';
    root.appendChild(node);
    root.scrollTop = root.scrollHeight;
  }

  function removeThinking() {
    document.getElementById('romeoThinking')?.remove();
  }

  async function callRomeo(prompt, session) {
    const endpoint = state.endpoint.replace(/\/+$/, '');
    const response = await fetch(`${endpoint}/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Romeo-Key': state.apiKey
      },
      body: JSON.stringify({
        prompt,
        session_id: state.memoryEnabled ? session.remoteSessionId : null,
        mode: state.mode,
        context: {
          source: 'senseos',
          workspace: 'SENSE Unified Workspace',
          custom_instructions: state.instructions,
          skills: state.skills,
          memory_enabled: state.memoryEnabled
        }
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || `Romeo API returned ${response.status}`);
    return payload;
  }

  async function localPreview(prompt) {
    await new Promise(resolve => setTimeout(resolve, 850));
    const mode = MODES[state.mode].label;
    return {
      trace_id: `preview-${uid()}`,
      session_id: `preview-${state.activeId}`,
      mode: state.mode,
      created_at: new Date().toISOString(),
      contributors: state.mode === 'gpt_only'
        ? [{ provider: 'openai', model: 'preview', status: 'ok', duration_ms: 420 }]
        : [
            { provider: 'openai', model: 'preview', status: 'ok', duration_ms: 390 },
            { provider: 'anthropic', model: 'preview', status: 'ok', duration_ms: 510 },
            { provider: 'xai', model: 'preview', status: 'ok', duration_ms: 470 }
          ],
      answer: `Romeo is operating in local preview mode. The ${mode} workflow accepted your request: “${prompt}”\n\nConnect the deployed Project Romeo endpoint and access key in the right-side Connection panel to run the real GPT-led orchestration service. Your selected instructions, skills, mode, and session-memory setting are already included in the request contract.`
    };
  }

  async function checkHealth() {
    const endpoint = state.endpoint.replace(/\/+$/, '');
    const status = document.getElementById('romeoStatus');
    try {
      const response = await fetch(`${endpoint}/health`, { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      const health = await response.json();
      state.health = health;
      status.className = `romeo-status ${health.status === 'ok' ? 'online' : 'degraded'}`;
      status.querySelector('span').textContent = health.status === 'ok' ? 'Romeo online' : 'Romeo degraded';
      renderProviders([]);
      return true;
    } catch {
      state.health = null;
      status.className = 'romeo-status offline';
      status.querySelector('span').textContent = 'Local preview';
      renderProviders([]);
      return false;
    }
  }

  async function saveConnection() {
    const endpoint = document.getElementById('romeoEndpoint').value.trim().replace(/\/+$/, '');
    const key = document.getElementById('romeoApiKey').value.trim();
    state.endpoint = endpoint;
    state.apiKey = key;
    if (endpoint) localStorage.setItem(ENDPOINT_KEY, endpoint);
    else localStorage.removeItem(ENDPOINT_KEY);
    if (key) sessionStorage.setItem(API_KEY, key);
    else sessionStorage.removeItem(API_KEY);
    if (!endpoint) {
      toast('Romeo remains in local preview mode.');
      await checkHealth();
      return;
    }
    const ok = await checkHealth();
    toast(ok ? 'Romeo service is reachable.' : 'Romeo service could not be reached.');
  }

  function saveContext() {
    state.instructions = document.getElementById('romeoInstructions').value.trim();
    state.memoryEnabled = document.getElementById('romeoMemory').checked;
    localStorage.setItem(INSTRUCTIONS_KEY, state.instructions);
    localStorage.setItem(SKILLS_KEY, JSON.stringify(state.skills));
    localStorage.setItem(MEMORY_KEY, String(state.memoryEnabled));
    toast('Romeo context saved on this device.');
  }

  async function showRun(traceId) {
    const session = activeSession();
    const localRun = session?.runs?.find(run => run.traceId === traceId);
    if (!traceId || traceId.startsWith('local-') || traceId.startsWith('preview-') || !state.endpoint || !state.apiKey) {
      renderReceipt(localRun);
      toast('Run receipt loaded.');
      return;
    }
    try {
      const response = await fetch(`${state.endpoint.replace(/\/+$/, '')}/v1/runs/${encodeURIComponent(traceId)}`, {
        headers: { 'X-Romeo-Key': state.apiKey }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `Run lookup returned ${response.status}`);
      const run = {
        traceId: payload.trace_id,
        remoteSessionId: payload.session_id,
        mode: payload.mode,
        createdAt: payload.created_at,
        contributors: [
          payload.plan,
          ...(payload.specialist_results || []),
          payload.draft,
          ...(payload.critiques || []),
          payload.final
        ].filter(Boolean).map(item => ({
          provider: item.provider,
          model: item.model,
          status: item.status,
          duration_ms: item.duration_ms
        }))
      };
      renderReceipt(run);
      toast('Romeo run provenance loaded.');
    } catch (error) {
      toast(error.message);
    }
  }

  function openRomeo(updateHash = true) {
    if (state.open) return;
    state.open = true;
    state.lastHash = location.hash === '#/romeo' ? '' : location.hash;
    const shell = document.getElementById('romeoShell');
    shell.classList.add('open');
    shell.setAttribute('aria-hidden', 'false');
    document.getElementById('romeoLauncher').style.display = 'none';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    if (updateHash && location.hash !== '#/romeo') history.pushState(null, '', '#/romeo');
    setTimeout(() => document.getElementById('romeoPrompt').focus(), 60);
    if (state.endpoint) checkHealth();
  }

  function closeRomeo(updateHash = true) {
    if (!state.open) return;
    state.open = false;
    const shell = document.getElementById('romeoShell');
    shell.classList.remove('open');
    shell.setAttribute('aria-hidden', 'true');
    document.getElementById('romeoLauncher').style.display = '';
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    if (updateHash && location.hash === '#/romeo') history.replaceState(null, '', state.lastHash || '#/home');
  }

  let toastTimer;
  function toast(message) {
    const node = document.getElementById('romeoToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
  }

  function boot() {
    injectStyles();
    buildUi();
    window.SENSE_ROMEO = {
      version: VERSION,
      open: () => openRomeo(true),
      close: () => closeRomeo(true),
      newSession
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
