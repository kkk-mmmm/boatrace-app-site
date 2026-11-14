/* GTM and delegated interaction tracking; no prediction or form data. */
(() => {
 if(window.__funeyomiAnalyticsInstalled)return;
 window.__funeyomiAnalyticsInstalled=true;
 window.dataLayer=window.dataLayer||[];
 window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};
 window.gtag('js',new Date());
 window.dataLayer.push({'gtm.start':Date.now(),event:'gtm.js'});
 const tag=document.createElement('script');tag.async=true;
 tag.src='https://www.googletagmanager.com/gtm.js?id=GTM-TP88TNCZ';document.head.appendChild(tag);
 const tabs={'probability-tab':'推定確率順','value-tab':'期待値上位','return-tab':'高配当条件','condition-tab':'条件別検証','race-prediction-tab':'予想','race-details-tab':'出走表・展示','development-tab':'展開予想','result-tab':'結果','entries-tab':'出走表','exhibition-tab':'展示','live-tab':'今日のレース','archive-tab':'検証企画・記事','releases-tab':'リリースノート'};
 const clean=x=>String(x||'').replace(/\s+/g,' ').trim().slice(0,100);
 const venue=x=>/^\d{2}$/.test(x||'')&&+x>=1&&+x<=24?x:'';
 const race=x=>/^\d{1,2}$/.test(String(x||''))&&+x>=1&&+x<=12?String(+x):'';
 function place(n){
  for(const id of ['upcoming-content','opportunities-content','live-content','archive-view','releases-view'])if(n.closest('#'+id))return id;
  for(const [selector,label] of [['header','header'],['footer','footer'],['.mobile-nav','mobile_nav'],['.explainer-entry','home_explainer']])if(n.closest(selector))return label;
  return 'page_content';
 }
 function emit(id,name,n){window.dataLayer.push({event:'content_click',content_id:clean(id),content_name:clean(name),placement:place(n)});}
 // Capture preserves the clicked node before the application re-renders it.
 document.addEventListener('click',event=>{
  if(event.button!==undefined&&event.button!==0)return;
  const n=event.target?.closest?.('a,button');
  if(!n||n.disabled||n.getAttribute('aria-disabled')==='true')return;
  const d=n.dataset;
  const v=venue(document.querySelector('#venue-select')?.value)||venue(document.body.dataset.venue)||venue(new URL(location.href).searchParams.get('venue'));
  const r=race(document.querySelector('[data-race][aria-pressed="true"]')?.dataset.race);
  const cv=venue(d.opportunityVenue||d.upcomingVenue),cr=race(d.opportunityRace||d.upcomingRace);
  if(cv&&cr){emit('race_'+cv+'_'+cr,cv+'場 '+cr+'R',n);return;}
  if(venue(d.venueResult)){emit('venue_'+d.venueResult,d.venueResult+'場を選択',n);return;}
  if(race(d.race)){emit('race_'+(v||'unknown')+'_'+race(d.race),(v||'未確認')+'場 '+race(d.race)+'R',n);return;}
  if(tabs[n.id]){emit('tab_'+n.id,tabs[n.id],n);return;}
  if(d.featuredTab){emit('featured_'+d.featuredTab,n.textContent,n);return;}
  if(n.id==='development-replay'||n.id==='development-pause'){
   const action=n.id==='development-replay'?'replay':clean(n.textContent)==='一時停止'?'pause':'play';
   emit('development_'+action+'_'+(v||'unknown')+'_'+(r||'unknown'),{replay:'展開予想をもう一度再生',pause:'展開予想を一時停止',play:'展開予想を再生'}[action],n);return;
  }
  if(n.tagName!=='A')return;
  let url;try{url=new URL(n.getAttribute('href'),document.baseURI);}catch{return;}
  if(!['http:','https:'].includes(url.protocol))return;
  if(url.origin===location.origin){
   if(url.hash==='#main-content')return;
   const match=url.pathname.match(/\/venues\/(\d{2})\//),nr=race(url.searchParams.get('race'));
   if(match&&venue(match[1])){emit(nr?'race_'+match[1]+'_'+nr:'venue_'+match[1],n.textContent,n);return;}
   emit('link_'+url.pathname,clean(n.textContent)||url.pathname,n);
  }else if(url.hostname==='boatrace.jp'||url.hostname.endsWith('.boatrace.jp'))emit('official_'+url.pathname,clean(n.textContent)||'公式サイト',n);
 },true);
 document.addEventListener('change',event=>{
  const n=event.target;if(n?.id==='venue-select'&&!n.disabled&&venue(n.value))emit('venue_'+n.value,n.value+'場を選択',n);
 },true);
})();
