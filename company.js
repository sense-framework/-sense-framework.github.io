(() => {
  'use strict';
  const files=Array.from({length:8},(_,i)=>`./_company/company.part-${String(i).padStart(2,'0')}?v=0.6.0`);
  Promise.all(files.map(async file=>{
    const response=await fetch(file,{cache:'no-store'});
    if(!response.ok)throw new Error(`Missing company module (${response.status})`);
    return response.text();
  })).then(parts=>{
    const script=document.createElement('script');
    script.textContent=parts.join('');
    document.body.appendChild(script);
  }).catch(error=>{
    console.error('SENSE company module failed to start',error);
    const node=document.createElement('div');
    node.className='toast show';
    node.textContent='Company portal could not start. Refresh the page.';
    document.body.appendChild(node);
  });
})();
