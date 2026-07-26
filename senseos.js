(() => {
'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const STORE = 'sense.workspace.empty.v1';
const EMPTY = {
  posts: [], conversations: [], people: [], teams: [], files: [], projects: [], events: [],
  notifications: [], broadcasts: [], audit: [], faq: [], contact: [],
  departments: [], knowledge: [], policies: [], tasks: [], approvals: [], requests: [],
  assets: [], forms: [], jobs: [], courses: [], services: [],
  documents: { security: '', privacy: '', terms: '' },
  profile: { name: '', title: '', department: '', location: '', bio: '' }
};
const titles = {
  home:'SENSE', feed:'Feed', messages:'Messages', people:'People', teams:'Teams', files:'Files',
  projects:'Projects', calendar:'Calendar', organization:'Organization', knowledge:'Knowledge',
  policies:'Policies', tasks:'Tasks', approvals:'Approvals', requests:'Requests', assets:'Assets',
  forms:'Forms', careers:'Careers', learning:'Learning', analytics:'Analytics', status:'Status',
  ai:'AI', notifications:'Notifications', more:'More', profile:'Profile', admin:'Administration',
  store:'Shop', memberships:'Memberships', orders:'Orders',
  faq:'FAQ', contact:'Contact', security:'Security', privacy:'Privacy', terms:'Terms', system:'System'
};
let state = load();
let activeConversation = null;
let deferredInstall = null;
let toastTimer;

function clone(value){return JSON.parse(JSON.stringify(value))}
function load(){
  try{
    const value=JSON.parse(localStorage.getItem(STORE)||'null');
    if(!value||typeof value!=='object') return clone(EMPTY);
    return {
      ...clone(EMPTY),
      ...value,
      documents:{...EMPTY.documents,...(value.documents||{})},
      profile:{...EMPTY.profile,...(value.profile||{})}
    };
  }catch{return clone(EMPTY)}
}
function save(){
  localStorage.setItem(STORE,JSON.stringify(state));
  renderAll();
  window.dispatchEvent(new CustomEvent('sense:workspace-change',{detail:{workspace:state}}));
}
function uid(){return `${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`}
function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function time(value){
  if(!value)return '';
  try{return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value))}
  catch{return ''}
}
function toast(text){const node=$('#toast');node.textContent=text;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),2300)}
function audit(action){state.audit.unshift({id:uid(),action,at:new Date().toISOString()});state.audit=state.audit.slice(0,150)}
function empty(icon,label,detail=''){return `<div class="empty-state"><span>${icon}</span><h2>${label}</h2>${detail?`<p>${detail}</p>`:''}</div>`}
function show(view,replace=false){
  if(!titles[view])view='home';
  $$('.view').forEach(node=>node.classList.toggle('active',node.id===`view-${view}`));
  $$('.nav-target').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
  $('#viewTitle').textContent=titles[view];
  $('#workspace').scrollTop=0;
  const hash=`#/${view}`;
  if(location.hash!==hash){
    if(replace)history.replaceState(null,'',hash);
    else history.pushState(null,'',hash);
  }
  window.dispatchEvent(new CustomEvent('sense:route',{detail:{view}}));
}
function openApp(){
  $('#landing').classList.add('hidden');
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  window.dispatchEvent(new Event('sense:open'));
  const route=location.hash.replace(/^#\//,'').split('?')[0];
  show(titles[route]?route:'home',true);
}
function hydrate(value){
  if(!value||typeof value!=='object')return;
  state={
    ...clone(EMPTY),
    ...value,
    documents:{...EMPTY.documents,...(value.documents||{})},
    profile:{...EMPTY.profile,...(value.profile||{})}
  };
  localStorage.setItem(STORE,JSON.stringify(state));
  renderAll();
}
function updateCounts(){
  $$('[data-count]').forEach(node=>{
    const key=node.dataset.count;
    node.textContent=Array.isArray(state[key])?state[key].length:0;
  });
}
function renderCards(root,key,icon,formatter,label=key){
  const items=state[key]||[];
  root.innerHTML=items.length?items.map(formatter).join(''):empty(icon,`No ${label}`);
}
function recordHeader(title,key,id){
  return `<header><h2>${esc(title)}</h2><button data-delete="${key}:${id}" aria-label="Delete">×</button></header>`;
}

function renderFeed(){renderCards($('#feedList'),'posts','◉',p=>`<article class="glass record-card">${recordHeader(p.title||'Post','posts',p.id)}<p>${esc(p.body)}</p><small>${time(p.createdAt)}</small></article>`,'posts')}
function renderPeople(){renderCards($('#peopleList'),'people','◎',p=>`<article class="glass record-card">${recordHeader(p.name,'people',p.id)}<p>${esc(p.email||'')}</p><span class="badge">${esc(p.role||'Member')}</span></article>`,'people')}
function renderTeams(){renderCards($('#teamsList'),'teams','⬡',item=>`<article class="glass record-card">${recordHeader(item.name,'teams',item.id)}<p>${esc(item.description||'')}</p></article>`,'teams')}
function renderFiles(){renderCards($('#filesList'),'files','▣',item=>`<article class="glass record-card">${recordHeader(item.name,'files',item.id)}<p>${esc(item.type||'File')}</p><small>${Number(item.size||0).toLocaleString()} bytes</small></article>`,'files')}
function renderProjects(){renderCards($('#projectsList'),'projects','⌘',item=>`<article class="glass record-card">${recordHeader(item.name,'projects',item.id)}<p>${esc(item.description||'')}</p><span class="badge">${esc(item.status||'Active')}</span></article>`,'projects')}
function renderEvents(){renderCards($('#eventsList'),'events','◇',item=>`<article class="glass record-card">${recordHeader(item.title,'events',item.id)}<p>${esc(item.location||'')}</p><small>${time(item.start)}</small></article>`,'events')}
function renderNotifications(){renderCards($('#notificationsList'),'notifications','○',item=>`<article class="glass record-card">${recordHeader(item.title,'notifications',item.id)}<p>${esc(item.body||'')}</p><small>${time(item.createdAt)}</small></article>`,'notifications')}
function renderFaq(){renderCards($('#faqList'),'faq','?',item=>`<article class="glass record-card">${recordHeader(item.question,'faq',item.id)}<p>${esc(item.answer||'')}</p></article>`,'FAQ entries')}

function renderOrganization(){
  renderCards($('#departmentsList'),'departments','⬢',item=>`<article class="glass record-card">${recordHeader(item.name,'departments',item.id)}<p>${esc(item.description||'')}</p><span class="badge">${esc(item.lead||'')}</span></article>`,'departments');
  const chart=$('#orgChart');
  if(!state.departments.length&&!state.people.length){chart.innerHTML=empty('⬢','No organization data');return}
  chart.innerHTML=`<div class="org-node root-node">SENSE</div><div class="org-branches">${state.departments.map(dep=>`<div class="org-node"><b>${esc(dep.name)}</b><small>${esc(dep.lead||'')}</small></div>`).join('')}</div>`;
}
function renderKnowledge(){renderCards($('#knowledgeList'),'knowledge','▤',item=>`<article class="glass record-card">${recordHeader(item.title,'knowledge',item.id)}<span class="badge">${esc(item.category||'')}</span><p>${esc(item.body||'')}</p></article>`,'articles')}
function renderPolicies(){renderCards($('#policiesList'),'policies','§',item=>`<article class="glass record-card">${recordHeader(item.title,'policies',item.id)}<span class="badge">${esc(item.owner||'')}</span><p>${esc(item.body||'')}</p></article>`,'policies')}
function renderTasks(){
  const root=$('#tasksBoard');
  const groups=['To do','In progress','Done'];
  root.innerHTML=groups.map(status=>{
    const items=state.tasks.filter(task=>(task.status||'To do')===status);
    return `<section class="glass board-column"><header><h2>${status}</h2><b>${items.length}</b></header>${items.length?items.map(item=>`<article class="board-card"><button data-delete="tasks:${item.id}">×</button><h3>${esc(item.title)}</h3><p>${esc(item.assignee||'')}</p><small>${item.due?time(item.due):''}</small></article>`).join(''):empty('✓','No tasks')}</section>`;
  }).join('');
}
function renderApprovals(){renderCards($('#approvalsList'),'approvals','⌁',item=>`<article class="glass record-card">${recordHeader(item.title,'approvals',item.id)}<p>${esc(item.requester||'')}</p><span class="badge">${esc(item.status||'Pending')}</span></article>`,'approvals')}
function renderRequests(){renderCards($('#requestsList'),'requests','↗',item=>`<article class="glass record-card">${recordHeader(item.subject,'requests',item.id)}<p>${esc(item.category||'')}</p><div class="record-meta"><span class="badge">${esc(item.priority||'Normal')}</span><span class="badge">${esc(item.status||'Open')}</span></div></article>`,'requests')}
function renderAssets(){renderCards($('#assetsList'),'assets','▧',item=>`<article class="glass record-card">${recordHeader(item.name,'assets',item.id)}<p>${esc(item.type||'')}</p><small>${esc(item.assignee||'')}</small><span class="badge">${esc(item.serial||'')}</span></article>`,'assets')}
function renderForms(){renderCards($('#formsList'),'forms','≡',item=>`<article class="glass record-card">${recordHeader(item.name,'forms',item.id)}<p>${esc(item.owner||'')}</p><span class="badge">${esc(item.status||'Draft')}</span></article>`,'forms')}
function renderJobs(){renderCards($('#jobsList'),'jobs','◇',item=>`<article class="glass record-card">${recordHeader(item.title,'jobs',item.id)}<p>${esc(item.department||'')} ${item.location?`· ${esc(item.location)}`:''}</p><span class="badge">${esc(item.status||'Open')}</span></article>`,'openings')}
function renderCourses(){renderCards($('#coursesList'),'courses','△',item=>`<article class="glass record-card">${recordHeader(item.title,'courses',item.id)}<p>${esc(item.owner||'')}</p><span class="badge">${esc(item.status||'Draft')}</span></article>`,'courses')}
function renderServices(){renderCards($('#servicesList'),'services','●',item=>`<article class="glass record-card service-card">${recordHeader(item.name,'services',item.id)}<p>${esc(item.description||'')}</p><span class="status-dot ${esc((item.status||'Operational').toLowerCase().replace(/\s+/g,'-'))}"></span><span class="badge">${esc(item.status||'Operational')}</span></article>`,'services')}
function renderAnalytics(){
  const metrics=[
    ['People',state.people.length],['Teams',state.teams.length],['Projects',state.projects.length],
    ['Tasks',state.tasks.length],['Requests',state.requests.length],['Assets',state.assets.length],
    ['Knowledge',state.knowledge.length],['Openings',state.jobs.length]
  ];
  $('#analyticsGrid').innerHTML=metrics.map(([label,value])=>`<article class="glass metric-card"><small>${label}</small><strong>${value}</strong><div class="metric-line"><i style="width:${Math.min(100,value*8)}%"></i></div></article>`).join('');
}
function renderProfile(){
  $('#profileName').value=state.profile.name||'';
  $('#profileTitle').value=state.profile.title||'';
  $('#profileDepartment').value=state.profile.department||'';
  $('#profileLocation').value=state.profile.location||'';
  $('#profileBio').value=state.profile.bio||'';
}
function renderDocuments(){
  $$('[data-document]').forEach(node=>{
    const key=node.dataset.document;
    const value=state.documents[key]||'';
    node.innerHTML=value?`<p>${esc(value).replace(/\n/g,'<br>')}</p><button class="secondary" data-edit-document="${key}">Edit</button>`:`<button class="secondary" data-edit-document="${key}">Add content</button>`;
  });
}
function renderAdmin(){
  const root=$('#auditList');
  if(!root)return;
  root.innerHTML=state.audit.length?state.audit.map(item=>`<div class="audit-row"><b>${esc(item.action)}</b><small>${time(item.at)}</small></div>`).join(''):empty('◆','No audit entries');
}
function renderMessages(){
  const list=$('#conversationList'),messages=$('#messageList'),header=$('#conversationHeader');
  if(!state.conversations.length){list.innerHTML=empty('✉','No conversations');messages.innerHTML='';header.textContent='Messages';activeConversation=null;return}
  if(!activeConversation||!state.conversations.some(item=>item.id===activeConversation))activeConversation=state.conversations[0].id;
  list.innerHTML=state.conversations.map(item=>`<button class="conversation-row ${item.id===activeConversation?'active':''}" data-conversation="${item.id}"><b>${esc(item.name)}</b><small>${esc(item.messages.at(-1)?.text||'')}</small></button>`).join('');
  const current=state.conversations.find(item=>item.id===activeConversation);
  header.textContent=current.name;
  messages.innerHTML=current.messages.length?current.messages.map(message=>`<div class="message-bubble ${message.me?'me':''}">${esc(message.text)}<small>${time(message.at)}</small></div>`).join(''):empty('✉','No messages');
  messages.scrollTop=messages.scrollHeight;
}
function renderSearch(query=''){
  const root=$('#searchResults'),q=query.trim().toLowerCase();
  if(!q){root.innerHTML='';return}
  const items=[];
  Object.entries(titles).forEach(([view,label])=>items.push({label,view}));
  [
    ['people','name','people'],['teams','name','teams'],['projects','name','projects'],['files','name','files'],
    ['events','title','calendar'],['faq','question','faq'],['departments','name','organization'],
    ['knowledge','title','knowledge'],['policies','title','policies'],['tasks','title','tasks'],
    ['approvals','title','approvals'],['requests','subject','requests'],['assets','name','assets'],
    ['forms','name','forms'],['jobs','title','careers'],['courses','title','learning'],['services','name','status']
  ].forEach(([key,field,view])=>(state[key]||[]).forEach(item=>items.push({label:item[field],view})));
  const matches=items.filter(item=>String(item.label||'').toLowerCase().includes(q)).slice(0,16);
  root.innerHTML=matches.length?matches.map(item=>`<button class="search-result" data-search-view="${item.view}">${esc(item.label)}<span>Open</span></button>`).join(''):'<p>No results</p>';
}
function renderAll(){
  updateCounts();
  renderFeed();renderPeople();renderTeams();renderFiles();renderProjects();renderEvents();
  renderNotifications();renderFaq();renderOrganization();renderKnowledge();renderPolicies();renderTasks();
  renderApprovals();renderRequests();renderAssets();renderForms();renderJobs();renderCourses();
  renderServices();renderAnalytics();renderProfile();renderDocuments();renderAdmin();renderMessages();
  bindDynamic();
}

function field(label,name,type='text',required=true,options=''){
  if(type==='select')return `<label>${label}<select name="${name}" ${required?'required':''}>${options}</select></label>`;
  return `<label>${label}<input name="${name}" type="${type}" ${required?'required':''}></label>`;
}
function textarea(label,name,required=true){return `<label>${label}<textarea name="${name}" ${required?'required':''}></textarea></label>`}
function opts(values){return values.map(value=>`<option value="${value}">${value}</option>`).join('')}
const forms={
  post:{title:'New post',fields:field('Title','title','text',false)+textarea('Post','body'),save:d=>state.posts.unshift({id:uid(),title:d.title,body:d.body,createdAt:new Date().toISOString()})},
  conversation:{title:'New message',fields:field('Name','name')+textarea('Message','message',false),save:d=>{const item={id:uid(),name:d.name,messages:[]};if(d.message)item.messages.push({id:uid(),text:d.message,me:true,at:new Date().toISOString()});state.conversations.unshift(item);activeConversation=item.id}},
  person:{title:'Invite',fields:field('Name','name')+field('Email','email','email')+field('Role','role','text',false),save:d=>state.people.unshift({id:uid(),...d})},
  team:{title:'New team',fields:field('Name','name')+textarea('Description','description',false),save:d=>state.teams.unshift({id:uid(),...d})},
  project:{title:'New project',fields:field('Name','name')+textarea('Description','description',false)+field('Status','status','select',true,opts(['Active','On hold','Complete'])),save:d=>state.projects.unshift({id:uid(),...d})},
  event:{title:'New event',fields:field('Title','title')+field('Start','start','datetime-local')+field('Location','location','text',false),save:d=>state.events.unshift({id:uid(),...d})},
  faq:{title:'New FAQ entry',fields:field('Question','question')+textarea('Answer','answer',false),save:d=>state.faq.unshift({id:uid(),...d})},
  department:{title:'New department',fields:field('Name','name')+field('Lead','lead','text',false)+textarea('Description','description',false),save:d=>state.departments.unshift({id:uid(),...d})},
  knowledge:{title:'New article',fields:field('Title','title')+field('Category','category','text',false)+textarea('Content','body',false),save:d=>state.knowledge.unshift({id:uid(),...d})},
  policy:{title:'New policy',fields:field('Title','title')+field('Owner','owner','text',false)+textarea('Content','body',false),save:d=>state.policies.unshift({id:uid(),...d})},
  task:{title:'New task',fields:field('Title','title')+field('Assignee','assignee','text',false)+field('Due','due','datetime-local',false)+field('Status','status','select',true,opts(['To do','In progress','Done'])),save:d=>state.tasks.unshift({id:uid(),...d})},
  approval:{title:'New approval',fields:field('Title','title')+field('Requester','requester','text',false)+field('Status','status','select',true,opts(['Pending','Approved','Rejected'])),save:d=>state.approvals.unshift({id:uid(),...d})},
  request:{title:'New request',fields:field('Subject','subject')+field('Category','category','text',false)+field('Priority','priority','select',true,opts(['Low','Normal','High','Urgent']))+field('Status','status','select',true,opts(['Open','In progress','Resolved'])),save:d=>state.requests.unshift({id:uid(),...d})},
  asset:{title:'New asset',fields:field('Name','name')+field('Type','type','text',false)+field('Assigned to','assignee','text',false)+field('Serial','serial','text',false),save:d=>state.assets.unshift({id:uid(),...d})},
  form:{title:'New form',fields:field('Name','name')+field('Owner','owner','text',false)+field('Status','status','select',true,opts(['Draft','Published','Archived'])),save:d=>state.forms.unshift({id:uid(),...d})},
  job:{title:'New opening',fields:field('Title','title')+field('Department','department','text',false)+field('Location','location','text',false)+field('Status','status','select',true,opts(['Open','Paused','Closed'])),save:d=>state.jobs.unshift({id:uid(),...d})},
  course:{title:'New course',fields:field('Title','title')+field('Owner','owner','text',false)+field('Status','status','select',true,opts(['Draft','Published','Archived'])),save:d=>state.courses.unshift({id:uid(),...d})},
  service:{title:'New service',fields:field('Name','name')+textarea('Description','description',false)+field('Status','status','select',true,opts(['Operational','Degraded','Outage','Maintenance'])),save:d=>state.services.unshift({id:uid(),...d})}
};
function openCreate(type){
  const config=forms[type];
  if(!config)return;
  $('#modalBody').innerHTML=`<h2>${config.title}</h2><form id="dynamicForm">${config.fields}<button class="primary">Save</button></form>`;
  $('#modal').classList.remove('hidden');
  $('#dynamicForm').onsubmit=event=>{
    event.preventDefault();
    const data=Object.fromEntries(new FormData(event.target));
    config.save(data);
    audit(`${config.title} created`);
    save();closeModal();toast('Saved');
  };
}
function editDocument(key){
  $('#modalBody').innerHTML=`<h2>${titles[key]||key}</h2><form id="documentForm"><label>Content<textarea name="content">${esc(state.documents[key]||'')}</textarea></label><button class="primary">Save</button></form>`;
  $('#modal').classList.remove('hidden');
  $('#documentForm').onsubmit=event=>{
    event.preventDefault();
    state.documents[key]=new FormData(event.target).get('content').trim();
    audit(`${titles[key]||key} updated`);
    save();closeModal();toast('Saved');
  };
}
function closeModal(){$('#modal').classList.add('hidden');$('#modalBody').innerHTML=''}
function bindDynamic(){
  $$('[data-delete]').forEach(button=>button.onclick=()=>{
    const [key,id]=button.dataset.delete.split(':');
    state[key]=state[key].filter(item=>item.id!==id);
    audit(`${key} record removed`);
    save();
  });
  $$('[data-conversation]').forEach(button=>button.onclick=()=>{
    activeConversation=button.dataset.conversation;
    renderMessages();bindDynamic();
  });
  $$('[data-search-view]').forEach(button=>button.onclick=()=>{
    $('#searchOverlay').classList.add('hidden');
    show(button.dataset.searchView);
  });
  $$('[data-edit-document]').forEach(button=>button.onclick=()=>editDocument(button.dataset.editDocument));
}
function exportData(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;link.download='sense-workspace-data.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),500);
}
function bind(){
  setTimeout(()=>$('#boot').classList.add('done'),700);
  $('#openAuth').onclick=()=>$('#auth').classList.remove('hidden');
  $('#closeAuth').onclick=()=>$('#auth').classList.add('hidden');
  $('#loginForm').onsubmit=event=>{event.preventDefault();window.SENSE_AUTH?.login?.()};
  $$('.nav-target').forEach(button=>button.addEventListener('click',()=>show(button.dataset.view)));
  $$('[data-create]').forEach(button=>button.onclick=()=>openCreate(button.dataset.create));
  $('#closeModal').onclick=closeModal;
  $('#modal').addEventListener('click',event=>{if(event.target===$('#modal'))closeModal()});
  $('#uploadFile').onclick=()=>$('#filePicker').click();
  $('#filePicker').onchange=event=>{
    [...event.target.files].forEach(file=>state.files.unshift({id:uid(),name:file.name,type:file.type||'File',size:file.size}));
    if(event.target.files.length){audit(`${event.target.files.length} file record(s) added`);save();toast('Added')}
    event.target.value='';
  };
  $('#messageForm').onsubmit=event=>{
    event.preventDefault();
    const input=$('#messageInput'),text=input.value.trim();
    if(!text||!activeConversation)return;
    state.conversations.find(item=>item.id===activeConversation).messages.push({id:uid(),text,me:true,at:new Date().toISOString()});
    input.value='';save();
  };
  if($('#broadcastForm'))$('#broadcastForm').onsubmit=event=>{
    event.preventDefault();
    const title=$('#broadcastTitle').value.trim(),body=$('#broadcastBody').value.trim();
    state.broadcasts.unshift({id:uid(),title,body,createdAt:new Date().toISOString()});
    state.notifications.unshift({id:uid(),title,body,createdAt:new Date().toISOString()});
    audit('Broadcast created');event.target.reset();save();toast('Saved');
  };
  $('#contactForm').onsubmit=event=>{
    event.preventDefault();
    state.contact.unshift({id:uid(),name:$('#contactName').value.trim(),email:$('#contactEmail').value.trim(),message:$('#contactMessage').value.trim(),createdAt:new Date().toISOString()});
    audit('Contact submission created');event.target.reset();save();toast('Submitted');
  };
  $('#profileForm').onsubmit=event=>{
    event.preventDefault();
    state.profile={name:$('#profileName').value.trim(),title:$('#profileTitle').value.trim(),department:$('#profileDepartment').value.trim(),location:$('#profileLocation').value.trim(),bio:$('#profileBio').value.trim()};
    audit('Profile updated');save();toast('Saved');
  };
  $('#clearNotifications').onclick=()=>{state.notifications=[];save()};
  $('#saveApi').onclick=()=>{
    const value=$('#apiEndpoint').value.trim();
    if(value)localStorage.setItem('sense.api',value);else localStorage.removeItem('sense.api');
    toast('Saved');
  };
  $('#apiEndpoint').value=localStorage.getItem('sense.api')||window.SENSE_CONFIG?.apiUrl||'';
  $('#logout').onclick=()=>window.SENSE_AUTH?.logout?.();
  $('#exportData').onclick=exportData;
  $('#resetData').onclick=()=>{
    if(confirm('Reset all local workspace data?')){state=clone(EMPTY);localStorage.removeItem(STORE);renderAll();toast('Local data reset')}
  };
  $('#searchButton').onclick=()=>{$('#searchOverlay').classList.remove('hidden');$('#globalSearch').focus()};
  $('#closeSearch').onclick=()=>$('#searchOverlay').classList.add('hidden');
  $('#globalSearch').oninput=event=>renderSearch(event.target.value);
  $('#aiForm').onsubmit=event=>{event.preventDefault();if($('#aiInput').value.trim())toast('AI service is not configured');$('#aiInput').value=''};
  $('#openRomeoFromAI').onclick=()=>window.SENSE_ROMEO?.open();
  $('#installButton').onclick=async()=>{
    if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null}
    else toast('Use Add to Home Screen');
  };
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event});
  window.addEventListener('hashchange',()=>{
    if($('#app').classList.contains('hidden'))return;
    const route=location.hash.replace(/^#\//,'').split('?')[0];
    if(titles[route])show(route,true);
  });
  document.addEventListener('keydown',event=>{
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();$('#searchOverlay').classList.remove('hidden');$('#globalSearch').focus()}
    if(event.key==='Escape'){$('#searchOverlay').classList.add('hidden');closeModal();$('#auth').classList.add('hidden')}
  });
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
window.SENSE_APP={open:openApp,show,hydrate,toast,state:()=>clone(state)};
function init(){renderAll();bind();window.dispatchEvent(new Event('sense:ready'))}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
