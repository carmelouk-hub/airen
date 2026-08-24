const API="/api/admin/v1";
const state={session:null,currentView:"overview",tenantDetail:null};
const titles={
  overview:"Overview",tenants:"Tenants",principals:"Principals & Roles",billing:"Plans & Subscriptions",
  entitlements:"Entitlements",capabilities:"Capabilities & Feature Flags",audit:"Audit",system:"System / API"
};
const content=document.querySelector("#content");
const banner=document.querySelector("#banner");
const apiState=document.querySelector("#api-state");
const identity=document.querySelector("#identity");
const title=document.querySelector("#view-title");

function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function can(permission){return Boolean(state.session?.platformPermissions?.includes(permission));}
function showBanner(message,kind="warn"){banner.textContent=message;banner.className=`banner ${kind}`;}
function hideBanner(){banner.className="banner hidden";banner.textContent="";}
function setApiState(label,kind="neutral"){apiState.textContent=label;apiState.className=`status ${kind}`;}
function idempotencyKey(){return `ui-${crypto.randomUUID()}`;}

async function api(path,options={}){
  const headers={"accept":"application/json",...(options.headers||{})};
  if(options.body!==undefined) headers["content-type"]="application/json";
  const response=await fetch(path.startsWith("/")?path:`${API}${path}`,{
    method:options.method||"GET",headers,body:options.body===undefined?undefined:JSON.stringify(options.body),
    credentials:"same-origin",cache:"no-store"
  });
  let payload={};try{payload=await response.json();}catch{}
  if(!response.ok){const error=new Error(payload.message||payload.error||`HTTP ${response.status}`);error.status=response.status;error.payload=payload;throw error;}
  return payload;
}

function table(items,columns){
  if(!Array.isArray(items)||!items.length)return `<div class="empty">No records returned.</div>`;
  const head=columns.map(([key,label])=>`<th>${escapeHtml(label||key)}</th>`).join("");
  const rows=items.map(item=>`<tr>${columns.map(([key])=>{
    const raw=item?.[key];const value=typeof raw==="object"?JSON.stringify(raw):raw;
    return `<td>${escapeHtml(value??"")}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function errorView(error,label){
  const status=error?.status;
  if(status===401){setApiState("Authentication required","bad");identity.textContent="Unauthenticated";showBanner("Authenticated Admin session required. No client-side authority is assumed.","bad");}
  else if(status===403){setApiState("Forbidden","warn");showBanner(`${label}: server authority denied this request.`,"warn");}
  else if(status>=500){setApiState("Degraded","bad");showBanner(`${label}: API unavailable or degraded. No stale state is treated as authority.`,"bad");}
  else showBanner(`${label}: ${error?.message||"request failed"}`,"warn");
  return `<div class="card"><h2>${escapeHtml(label)}</h2><p>${escapeHtml(error?.message||"Request failed")}</p></div>`;
}

async function loadSession(){
  try{
    const result=await api("/session/me");state.session=result.session;identity.textContent=result.session.identityId;setApiState("API ready","good");hideBanner();return true;
  }catch(error){state.session=null;content.innerHTML=errorView(error,"Session");return false;}
}

async function overview(){
  const session=state.session;
  content.innerHTML=`<div class="grid">
    <article class="card"><p class="muted">Identity</p><div class="metric">${escapeHtml(session?.identityId||"—")}</div></article>
    <article class="card"><p class="muted">Platform roles</p><div class="metric">${escapeHtml(session?.platformRoles?.length??0)}</div></article>
    <article class="card"><p class="muted">Effective permissions</p><div class="metric">${escapeHtml(session?.platformPermissions?.length??0)}</div></article>
    <article class="card"><p class="muted">Authority model</p><div class="metric">Server</div></article>
  </div>
  <article class="card"><h2>Governed boundary</h2><p>This interface is a client of <code>/api/admin/v1</code>. Visibility and disabled buttons are UX only; every direct API request is independently authenticated and authorized server-side.</p></article>`;
}

async function tenants(){
  try{
    const result=await api("/tenants");
    const rows=result.items||[];
    const html=rows.length?`<div class="table-wrap"><table><thead><tr><th>Tenant</th><th>Status</th><th>Locale</th><th>Timezone</th><th>Actions</th></tr></thead><tbody>${
      rows.map(t=>`<tr><td><button class="tenant-button" data-tenant="${escapeHtml(t.id)}">${escapeHtml(t.name)}<br><span class="muted">${escapeHtml(t.slug)}</span></button></td><td>${escapeHtml(t.status)}</td><td>${escapeHtml(t.locale)}</td><td>${escapeHtml(t.timezone)}</td><td><div class="actions">${
        `<button class="button" data-action="suspend-tenant" data-tenant="${escapeHtml(t.id)}" ${can("platform.tenants.suspend")?"":"disabled"}>Suspend</button>`+
        `<button class="button" data-action="reactivate-tenant" data-tenant="${escapeHtml(t.id)}" ${can("platform.tenants.reactivate")?"":"disabled"}>Reactivate</button>`
      }</div></td></tr>`).join("")
    }</tbody></table></div>`:`<div class="empty">No tenants returned.</div>`;
    content.innerHTML=`<article class="card"><div class="toolbar"><h2>Tenants</h2><span class="pill">${rows.length} loaded</span></div>${html}</article><section id="tenant-detail"></section>`;
  }catch(error){content.innerHTML=errorView(error,"Tenants");}
}

async function loadTenantDetail(tenantId){
  const target=document.querySelector("#tenant-detail");if(!target)return;
  target.innerHTML=`<article class="card"><p>Loading governed Tenant composition…</p></article>`;
  try{
    const [tenant,locations,domains,subscriptions,entitlements,overrides]=await Promise.allSettled([
      api(`/tenants/${encodeURIComponent(tenantId)}`),
      api(`/locations?tenantId=${encodeURIComponent(tenantId)}`),
      api(`/domains?tenantId=${encodeURIComponent(tenantId)}`),
      api(`/subscriptions?tenantId=${encodeURIComponent(tenantId)}`),
      api(`/entitlements/tenants?tenantId=${encodeURIComponent(tenantId)}`),
      api(`/feature-flags/overrides?tenantId=${encodeURIComponent(tenantId)}`)
    ]);
    const module=(name,result)=>result.status==="fulfilled"
      ?`<article class="card"><h3>${name}</h3><pre>${escapeHtml(JSON.stringify(result.value,null,2))}</pre></article>`
      :`<article class="card"><h3>${name}</h3><p class="muted">Module unavailable: ${escapeHtml(result.reason?.message||"denied")}</p></article>`;
    target.innerHTML=`<div class="grid">${module("Tenant",tenant)}${module("Locations",locations)}${module("Domains",domains)}${module("Subscriptions",subscriptions)}${module("Entitlements",entitlements)}${module("Feature overrides",overrides)}</div>`;
  }catch(error){target.innerHTML=errorView(error,"Tenant detail");}
}

async function principals(){
  try{
    const [principals,roles]=await Promise.all([api("/principals"),api("/roles")]);
    content.innerHTML=`<article class="card"><h2>Platform Principals</h2>${table(principals.items,[["identityId","Identity"],["displayName","Name"],["primaryEmail","Email"],["status","Status"]])}</article>
    <article class="card"><h2>Platform Roles</h2>${table(roles.items,[["roleKey","Role"],["permissionKeys","Permissions"],["protected","Protected"],["activeAssignmentCount","Active"]])}</article>`;
  }catch(error){content.innerHTML=errorView(error,"Principals & Roles");}
}

async function billing(){
  try{
    const [plans,subs]=await Promise.all([api("/plans"),api("/subscriptions")]);
    content.innerHTML=`<article class="card"><h2>Plans</h2>${table(plans.items,[["slug","Slug"],["name","Name"],["status","Status"],["currency","Currency"],["priceMinor","Price minor"],["billingPeriod","Period"]])}</article>
    <article class="card"><h2>Subscriptions</h2>${table(subs.items,[["id","Subscription"],["tenantId","Tenant"],["planId","Plan"],["status","Status"],["currentPeriodEnd","Period end"]])}</article>`;
  }catch(error){content.innerHTML=errorView(error,"Plans & Subscriptions");}
}

async function entitlements(){
  try{
    const [catalog,tenant]=await Promise.all([api("/entitlements/catalog"),api("/entitlements/tenants")]);
    content.innerHTML=`<article class="card"><h2>Entitlement catalog</h2>${table(catalog.items,[["entitlementKey","Key"],["description","Description"],["status","Status"]])}</article>
    <article class="card"><h2>Tenant entitlements</h2>${table(tenant.items,[["tenantId","Tenant"],["entitlementKey","Key"],["derivedState","State"],["enabled","Enabled"],["limitValue","Limit"]])}</article>`;
  }catch(error){content.innerHTML=errorView(error,"Entitlements");}
}

async function capabilities(){
  try{
    const [caps,flags,overrides]=await Promise.all([api("/capabilities"),api("/feature-flags"),api("/feature-flags/overrides")]);
    content.innerHTML=`<article class="card"><h2>Capabilities</h2>${table(caps.items,[["capabilityKey","Capability"],["status","Status"],["scopeKind","Scope"],["featureFlagKey","Feature Flag"],["requiredEntitlements","Entitlements"],["requiredPermissions","Permissions"]])}</article>
    <article class="card"><h2>Feature Flags</h2>${table(flags.items,[["featureFlagKey","Flag"],["status","Status"],["enabledDefault","Default"],["validFrom","From"],["validUntil","Until"]])}</article>
    <article class="card"><h2>Overrides</h2>${table(overrides.items,[["featureFlagKey","Flag"],["subjectKind","Subject"],["tenantId","Tenant"],["locationId","Location"],["enabled","Enabled"],["status","Status"]])}</article>`;
  }catch(error){content.innerHTML=errorView(error,"Capabilities & Feature Flags");}
}

async function audit(){
  const until=new Date();const from=new Date(until.getTime()-24*60*60*1000);
  try{
    const result=await api(`/audit?createdFrom=${encodeURIComponent(from.toISOString())}&createdUntil=${encodeURIComponent(until.toISOString())}&limit=50`);
    content.innerHTML=`<article class="card"><div class="toolbar"><h2>Platform Audit</h2><span class="pill">last 24h</span></div>${table(result.items,[["createdAt","Created"],["actionKey","Action"],["actorKind","Actor kind"],["tenantId","Tenant"],["locationId","Location"],["outcome","Outcome"],["correlationId","Correlation"]])}</article>`;
  }catch(error){content.innerHTML=errorView(error,"Audit");}
}

async function system(){
  try{
    const readiness=await api("/health/ready");
    content.innerHTML=`<div class="grid"><article class="card"><h2>API status</h2><div class="metric">${escapeHtml(readiness.status)}</div><p>Safe readiness diagnostics only.</p></article>
    <article class="card"><h2>Release</h2><pre>${escapeHtml(readiness.releaseRevision||"unknown")}</pre></article></div>
    <article class="card"><h2>Diagnostics</h2><pre>${escapeHtml(JSON.stringify(readiness,null,2))}</pre></article>`;
  }catch(error){content.innerHTML=errorView(error,"System / API");}
}

const loaders={overview,tenants,principals,billing,entitlements,capabilities,audit,system};
async function render(view){
  state.currentView=view;title.textContent=titles[view]||view;
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  content.innerHTML=`<article class="card"><p>Loading…</p></article>`;
  await loaders[view]();
}

document.querySelector("#navigation").addEventListener("click",(event)=>{
  const button=event.target.closest("[data-view]");if(button)void render(button.dataset.view);
});
content.addEventListener("click",async(event)=>{
  const tenant=event.target.closest("[data-tenant]")?.dataset.tenant;
  if(event.target.closest(".tenant-button")&&tenant){await loadTenantDetail(tenant);return;}
  const actionButton=event.target.closest("[data-action]");
  if(!actionButton||actionButton.disabled)return;
  const action=actionButton.dataset.action;
  try{
    if(action==="suspend-tenant")await api(`/tenants/${encodeURIComponent(tenant)}/suspend`,{method:"POST",headers:{"idempotency-key":idempotencyKey()},body:{reasonCode:"admin.ui"}});
    if(action==="reactivate-tenant")await api(`/tenants/${encodeURIComponent(tenant)}/reactivate`,{method:"POST",headers:{"idempotency-key":idempotencyKey()},body:{reasonCode:"admin.ui"}});
    await tenants();
  }catch(error){showBanner(`Action denied or failed: ${error.message}`,"warn");}
});

if(await loadSession())await render("overview");
