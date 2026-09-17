const results=[];
for(const url of ['https://nc-digital.co.uk/admin/crm-access-check','https://nc-digital.co.uk/admin/crm/','https://nc-digital.co.uk/admin/crm/api/workspace/today','https://www.nc-digital.co.uk/admin/crm/','https://nc-digital.nconstance.workers.dev/admin/crm/','https://nc-digital.co.uk/contact/','https://nc-digital.co.uk/website-cost-calculator/','https://nc-digital.co.uk/api/enquiries/config']){
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000)}),location=response.headers.get('location');
  results.push({url,status:response.status,redirect:location?new URL(location,url).origin+new URL(location,url).pathname:null,...(url.endsWith('/config')?{body:await response.json()}:{})});
}
console.log(JSON.stringify(results,null,2));
