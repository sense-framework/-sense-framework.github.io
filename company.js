(() => {
  'use strict';
  const VERSION='0.7.0';
  const files=Array.from({length:8},(_,i)=>`./_company/company.part-${String(i).padStart(2,'0')}?v=${VERSION}`);
  const ensureEnterprise=()=>{
    if(!document.querySelector('link[href*="enterprise.css"]')){
      const link=document.createElement('link');
      link.rel='stylesheet';
      link.href=`./enterprise.css?v=${VERSION}`;
      document.head.appendChild(link);
    }
    if(!document.querySelector('script[src*="enterprise.js"]')){
      const script=document.createElement('script');
      script.src=`./enterprise.js?v=${VERSION}`;
      script.defer=true;
      document.body.appendChild(script);
    }
  };
  Promise.all(files.map(async file=>{
    const response=await fetch(file,{cache:'no-store'});
    if(!response.ok)throw new Error(`Missing company module (${response.status})`);
    return response.text();
  })).then(parts=>{
    const script=document.createElement('script');
    script.textContent=parts.join('');
    document.body.appendChild(script);
    ensureEnterprise();
  }).catch(error=>{
    console.error('SENSE company module failed to start',error);
    ensureEnterprise();
    const node=document.createElement('div');
    node.className='toast show';
    node.textContent='Company portal could not start. Refresh the page.';
    document.body.appendChild(node);
  });
})();
