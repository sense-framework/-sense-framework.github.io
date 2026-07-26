(() => {
  'use strict';
  const STORE='sense.enterprise.v1';
  const required=['forms','jobs','applications','companies','contacts','deals','invoices','expenses','budgets','vendors','contracts','onboarding','reviews','goals','campaigns','leads','events'];
  try{
    const state=JSON.parse(localStorage.getItem(STORE)||'{}')||{};
    let changed=false;
    required.forEach(key=>{if(!Array.isArray(state[key])){state[key]=[];changed=true}});
    if(!state.settings||typeof state.settings!=='object'){state.settings={currency:'USD',fiscalYearStart:1};changed=true}
    if(changed||!localStorage.getItem(STORE))localStorage.setItem(STORE,JSON.stringify(state));
  }catch{
    localStorage.setItem(STORE,JSON.stringify(Object.fromEntries(required.map(key=>[key,[]]))));
  }
  function role(){return window.SENSE_SESSION?.user?.role||'member'}
  function admin(){return['owner','admin'].includes(role())}
  function notify(text){const node=document.querySelector('#toast');if(!node)return;node.textContent=text;node.classList.add('show');clearTimeout(node._enterpriseTimer);node._enterpriseTimer=setTimeout(()=>node.classList.remove('show'),2400)}
  const restrictedViews=new Set(['executive','finance','vendors','marketing','applications','formresponses']);
  document.addEventListener('click',event=>{
    if(admin())return;
    const view=event.target.closest('[data-enterprise-view]')?.dataset.enterpriseView;
    const create=event.target.closest('[data-enterprise-create]');
    const recruiting=event.target.closest('#newEnterpriseForm,#newEnterpriseJob,#publishForm,#deleteForm,[data-toggle-job],[data-edit-job],[data-delete-job],[data-delete-response]');
    if((view&&restrictedViews.has(view))||create||recruiting){event.preventDefault();event.stopImmediatePropagation();notify('Administrator access required.');}
  },true);
  window.SENSE_ENTERPRISE_ACCESS={role,canAdmin:admin};
})();
