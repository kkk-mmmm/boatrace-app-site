"""Configure the owned Pages domain only after public DNS matches GitHub Pages."""
import json,os,subprocess,time
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
config=json.loads(Path('site/domain-migration.json').read_text());domain=config['domain']
def dns(host,kind):return set(subprocess.check_output(['dig','+short',host,kind],text=True,timeout=15).strip().splitlines())
def notice(data):print('::notice title=Custom domain configuration::'+json.dumps(data,ensure_ascii=False).replace('%','%25'))
a=dns(domain,'A');www=dns('www.'+domain,'CNAME');expected=set(config['github_ipv4']);notice({'domain':domain,'ipv4':sorted(a),'www_cname':sorted(www)})
if a!=expected or www!={config['github_dns_name']+'.'}:raise SystemExit('DNS_NOT_READY: set the four apex A records and www CNAME to GitHub Pages, with DNS-only proxy mode.')
# Fail safely if unexpected IPv6 could send some visitors to a different service.
aaaa=dns(domain,'AAAA');github6={'2606:50c0:8000::153','2606:50c0:8001::153','2606:50c0:8002::153','2606:50c0:8003::153'}
if not aaaa.issubset(github6):raise SystemExit('Unexpected IPv6 records; review AAAA records before switching.')
repo=os.environ['GITHUB_REPOSITORY'];token=os.environ['GH_TOKEN']
def api(method='GET',payload=None):
 request=Request('https://api.github.com/repos/'+repo+'/pages',method=method,data=None if payload is None else json.dumps(payload).encode(),headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'})
 try:
  with urlopen(request,timeout=25) as response:
   body=response.read();return json.loads(body) if body else {}
 except HTTPError as e:
  raise RuntimeError('Pages API HTTP '+str(e.code)+': '+e.read(2000).decode(errors='replace')) from None
state=api()
if state.get('cname') not in (None,domain):raise SystemExit('A different custom domain is configured; refusing to overwrite it.')
if state.get('cname')!=domain:api('PUT',{'cname':domain})
ready=False
for attempt in range(12):
 try:
  with urlopen('https://'+domain+'/',timeout=15) as response:ready=response.status==200 and domain in response.url
 except Exception:pass
 if ready:break
 time.sleep(10)
if ready:
 try:api('PUT',{'https_enforced':True})
 except RuntimeError as e:notice({'https_enforcement':'PENDING','reason':str(e)})
state=api();notice({'domain':domain,'cname':state.get('cname'),'html_url':state.get('html_url'),'https_enforced':state.get('https_enforced'),'certificate':(state.get('https_certificate') or {}).get('state'),'https_ready':ready,'state':'READY' if ready and state.get('https_enforced') else 'CERTIFICATE_PENDING'})
