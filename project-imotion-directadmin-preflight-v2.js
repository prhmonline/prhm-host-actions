import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {z} from 'zod';
const BASE_SHA='6a4a5df37d6172b4f045f4be7e61bea7ca495da6a1636b3663c9a92485cc94ed';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const BASE=path.join(HERE,'.project-aranob-pubkey-inventory-base-'+BASE_SHA+'.mjs');
const BACK='/var/backups/prhm-agent-selfmaint';
const PREFIX='agent_mcp-src_plugins_project.js-';
const DIR='/home/prhm/.ssh';
const TOKEN='ARANOB_GIT_KEY_INVENTORY_V1';
const H=b=>createHash('sha256').update(b).digest('hex');
function fail(x){throw new Error(x)}
function ensureBase(){try{if(H(fs.readFileSync(BASE))===BASE_SHA)return}catch{}const suffix='-'+BASE_SHA+'.bak';const name=fs.readdirSync(BACK).filter(n=>n.startsWith(PREFIX)&&n.endsWith(suffix)).sort().reverse()[0];if(!name)fail('aranob_pubkey_base_missing');const b=fs.readFileSync(path.join(BACK,name));if(H(b)!==BASE_SHA)fail('aranob_pubkey_base_sha_mismatch');const t=BASE+'.'+process.pid+'.tmp';fs.writeFileSync(t,b,{mode:0o600,flag:'wx'});fs.renameSync(t,BASE);fs.chmodSync(BASE,0o600)}
ensureBase();
const base=await import(pathToFileURL(BASE).href+'?sha='+BASE_SHA);
if(typeof base.registerProjectPlugin!=='function')fail('aranob_pubkey_base_export_missing');
function match(a){return a&&a.project==='control_plane'&&a.command===TOKEN&&(!a.access||a.access==='read')}
function inventory(){const items=[];if(fs.existsSync(DIR)){for(const n of fs.readdirSync(DIR).sort()){if(!n.endsWith('.pub')||!/^[A-Za-z0-9._-]+$/.test(n))continue;const p=path.join(DIR,n);const s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink())continue;const v=fs.readFileSync(p,'utf8').trim();if(/^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+( .*)?$/.test(v))items.push({name:n,public_key:v})}}return {ok:true,action:'aranob_git_public_key_inventory_v1',read_only:true,items,private_key_exposed:false,production_mutation:false,database_mutation:false}}

const RETIRED_PROJECT_TOOLS=new Set([
  'honartik_iticket_pretoken_git_sync_v1'
]);

const PROJECT_EXEC_NAME='project_exec_v1';
const PROJECT_EXEC_MAX_OUTPUT=500000;

const PROJECT_EXEC_ALLOWED_FIRST=new Set([
  'git','npm','npx','pnpm','yarn','bun','node','php','composer','make'
]);

const PROJECT_EXEC_GIT_ALLOWED=new Set([
  'status','diff','log','show','rev-parse','ls-files',
  'remote','branch','fetch','add','commit','push','tag'
]);

const PROJECT_EXEC_FORBIDDEN =
  /\b(?:systemctl|service|sudo|su|ssh|scp|sftp|rsync|docker|podman|iptables|nft|firewall-cmd|mount|umount|reboot|shutdown|halt|poweroff|passwd|useradd|usermod|groupadd|mysql|mariadb|psql|sqlite3)\b/i;

const PROJECT_EXEC_FORBIDDEN_PATH =
  /(^|\s)\/(?:etc|root|var|opt|usr|boot|proc|sys|dev|home\/agent)(?:\/|\s|$)/i;

const PROJECT_EXEC_FORBIDDEN_SHELL =
  /[;&|`<>]|\$\(/;

const PROJECT_EXEC_FORBIDDEN_DB =
  /\b(?:migrate|migration|db:(?:seed|reset|drop|fresh)|schema:(?:drop|create))\b/i;

function projectExecText(obj){
  return {content:[{type:'text',text:JSON.stringify(obj)}]};
}

function projectExecDecode(result){
  const raw=result?.content?.find?.(x=>x?.type==='text')?.text;
  if(typeof raw!=='string')fail('project_exec_projects_result_missing');

  let parsed;
  try{parsed=JSON.parse(raw)}
  catch{fail('project_exec_projects_result_invalid')}

  if(
    !parsed ||
    parsed.ok!==true ||
    !parsed.projects ||
    typeof parsed.projects!=='object'
  ) fail('project_exec_projects_contract_invalid');

  return parsed.projects;
}

function projectExecValidateCommand(command){
  if(
    typeof command!=='string' ||
    command.length<1 ||
    command.length>20000
  ) fail('project_exec_command_invalid');

  if(
    /[\0\r\n]/.test(command) ||
    PROJECT_EXEC_FORBIDDEN_SHELL.test(command)
  ) fail('project_exec_shell_composition_rejected');

  if(
    PROJECT_EXEC_FORBIDDEN.test(command) ||
    PROJECT_EXEC_FORBIDDEN_PATH.test(command) ||
    PROJECT_EXEC_FORBIDDEN_DB.test(command)
  ) fail('project_exec_privileged_or_db_command_rejected');

  const parts=command.trim().split(/\s+/);
  const first=parts[0]||'';

  const localBin =
    /^(?:\.\/)?(?:yii|vendor\/bin\/[A-Za-z0-9._-]+)$/;

  if(
    !PROJECT_EXEC_ALLOWED_FIRST.has(first) &&
    !localBin.test(first)
  ) fail('project_exec_binary_rejected');

  if(first==='git'){
    const sub=parts[1]||'';
    if(!PROJECT_EXEC_GIT_ALLOWED.has(sub))
      fail('project_exec_git_subcommand_rejected');
  }
}

function projectExecOwner(root){
  const st=fs.lstatSync(root);

  if(
    !st.isDirectory() ||
    st.isSymbolicLink() ||
    fs.realpathSync(root)!==root
  ) fail('project_exec_root_invalid');

  const id=spawnSync(
    '/usr/bin/id',
    ['-nu',String(st.uid)],
    {encoding:'utf8',timeout:5000,maxBuffer:20000}
  );

  if(id.error||id.status!==0)
    fail('project_exec_owner_lookup_failed');

  const user=String(id.stdout||'').trim();

  if(!/^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(user))
    fail('project_exec_owner_invalid');

  const ge=spawnSync(
    '/usr/bin/getent',
    ['passwd',user],
    {encoding:'utf8',timeout:5000,maxBuffer:20000}
  );

  const fields=String(ge.stdout||'').trim().split(':');

  const home=
    ge.status===0 &&
    fields.length>=6 &&
    fields[5]?.startsWith('/')
      ? fields[5]
      : root;

  return {user,home};
}

function projectExecJournal(unit){
  const j=spawnSync(
    '/usr/bin/journalctl',
    ['-u',unit+'.service','--no-pager','-o','json'],
    {
      encoding:'utf8',
      timeout:10000,
      maxBuffer:PROJECT_EXEC_MAX_OUTPUT
    }
  );

  if(j.error||j.status!==0){
    return {
      output:'',
      error:j.error?.message||String(j.stderr||'').slice(0,120000)
    };
  }

  const messages=[];

  for(const line of String(j.stdout||'').split('\n')){
    if(!line.trim())continue;

    let rec;
    try{rec=JSON.parse(line)}
    catch{continue}

    // Exclude systemd manager messages. Keep only process output.
    if(String(rec?._PID||'')==='1')continue;

    const msg=rec?.MESSAGE;

    if(typeof msg==='string')
      messages.push(msg);
    else if(Array.isArray(msg))
      messages.push(msg.join(''));
  }

  return {
    output:messages.join('\n').slice(0,350000),
    error:''
  };
}

function projectExecRun(root,command,timeoutMs){
  projectExecValidateCommand(command);

  const {user,home}=projectExecOwner(root);

  const unit=
    'prhm-project-exec-'+
    process.pid+'-'+
    Date.now()+'-'+
    randomBytes(4).toString('hex');

  const args=[
    '--quiet',
    '--wait',
    '--collect',
    '--service-type=exec',
    '--unit='+unit,

    '--uid='+user,
    '--property=WorkingDirectory='+root,

    '--setenv=HOME='+home,
    '--setenv=LC_ALL=C.UTF-8',
    '--setenv=GIT_TERMINAL_PROMPT=0',

    '--property=NoNewPrivileges=yes',
    '--property=PrivateTmp=yes',
    '--property=ProtectSystem=strict',
    '--property=ProtectHome=read-only',
    '--property=ReadWritePaths='+root,

    '/bin/bash',
    '-lc',
    command
  ];

  const r=spawnSync(
    '/usr/bin/systemd-run',
    args,
    {
      encoding:'utf8',
      timeout:timeoutMs,
      maxBuffer:PROJECT_EXEC_MAX_OUTPUT
    }
  );

  const journal=projectExecJournal(unit);

  const transportError=[
    String(r.stderr||'').trim(),
    journal.error
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0,120000);

  return {
    exit_code:Number.isInteger(r.status)?r.status:null,
    signal:r.signal||null,
    error:r.error?.message||journal.error||null,
    stdout:journal.output,
    stderr:transportError,
    user,
    root
  };
}

const IMOTION_DA_TARGET='10.71.0.10';
const IMOTION_DA_DOMAINS=Object.freeze([
  'imotion.ir',
  'admin.imotion.ir',
  'gym.imotion.ir',
  'sale.imotion.ir',
  'i-motion.ir',
  'admin.i-motion.ir',
  'test.i-motion.ir',
  'imotion-iran.ir'
]);
const IMOTION_DA_MAX=600000;
const IMOTION_DA_ENV={
  PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  HOME:'/home/agent',
  LC_ALL:'C.UTF-8'
};

function imotionDaRun(bin,args,{input=null,timeout=30000,maxBuffer=IMOTION_DA_MAX,allowFailure=false}={}){
  const r=spawnSync(bin,args,{
    input,
    encoding:'utf8',
    timeout,
    maxBuffer,
    shell:false,
    env:IMOTION_DA_ENV
  });
  if(r.error)
    fail('imotion_da_probe_exec_error:'+path.basename(bin)+':'+r.error.message);
  if(r.status!==0&&!allowFailure)
    fail(
      'imotion_da_probe_exec_failed:'+
      path.basename(bin)+':'+
      String(r.stderr||r.stdout||r.status).slice(0,1400)
    );
  return {
    status:Number.isInteger(r.status)?r.status:null,
    stdout:String(r.stdout||'').trim(),
    stderr:String(r.stderr||'').trim()
  };
}

function imotionDaKeyscanBoundMaterial(){
  const scan=imotionDaRun(
    '/usr/bin/ssh-keyscan',
    ['-T','5','-t','ed25519',IMOTION_DA_TARGET],
    {timeout:8000,allowFailure:true}
  );

  if(scan.status!==0||!scan.stdout)
    fail('imotion_da_hostkey_scan_failed');

  const lines=scan.stdout
    .split(/\r?\n/)
    .map(x=>x.trim())
    .filter(x=>x&&!x.startsWith('#'));

  if(lines.length!==1)
    fail('imotion_da_hostkey_scan_cardinality');

  const parts=lines[0].split(/\s+/);

  if(
    parts.length<3 ||
    parts[0]!==IMOTION_DA_TARGET ||
    parts[1]!=='ssh-ed25519'
  ) fail('imotion_da_hostkey_scan_unexpected');

  const raw=Buffer.from(parts[2],'base64');

  if(!raw.length)
    fail('imotion_da_hostkey_blob_invalid');

  const fingerprint=
    'SHA256:'+
    createHash('sha256')
      .update(raw)
      .digest('base64')
      .replace(/=+$/,'');

  return {
    known_hosts:lines[0]+'\n',
    fingerprint
  };
}

function imotionDaRemoteBound(script,knownHosts){
  const kh=
    '/tmp/prhm-imotion-da-kh-'+
    process.pid+'-'+
    Date.now();

  fs.writeFileSync(
    kh,
    knownHosts,
    {mode:0o600,flag:'wx'}
  );

  try{
    const args=[
      '-o','BatchMode=yes',
      '-o','ConnectTimeout=8',
      '-o','ConnectionAttempts=1',
      '-o','PasswordAuthentication=no',
      '-o','KbdInteractiveAuthentication=no',
      '-o','StrictHostKeyChecking=yes',
      '-o','UserKnownHostsFile='+kh,
      '-o','GlobalKnownHostsFile=/dev/null',
      '-o','UpdateHostKeys=no',
      '-o','VerifyHostKeyDNS=no',
      'root@'+IMOTION_DA_TARGET,
      '/bin/bash',
      '-s'
    ];

    return imotionDaRun(
      '/usr/bin/ssh',
      args,
      {
        input:script,
        timeout:45000,
        maxBuffer:IMOTION_DA_MAX,
        allowFailure:true
      }
    );
  } finally {
    try{fs.unlinkSync(kh)}catch{}
  }
}

function imotionDaPreflightScript(){
  const domains=
    IMOTION_DA_DOMAINS
      .map(x=>`'${x}'`)
      .join(' ');

  return `set -euo pipefail
export LC_ALL=C.UTF-8
DA=/usr/local/directadmin/directadmin
echo IMOTION_DA_PREFLIGHT_V2=1
printf 'HOSTNAME='; hostname
if [ -x "$DA" ]; then echo DIRECTADMIN_BINARY=yes; else echo DIRECTADMIN_BINARY=no; exit 31; fi
printf 'DIRECTADMIN_VERSION='; "$DA" version | tr '\n' ' ' | sed 's/[[:space:]]\\+/ /g'; echo
printf 'DIRECTADMIN_ADMIN='; "$DA" admin
printf 'DIRECTADMIN_SERVICE='; systemctl is-active directadmin || true
if ss -ltn 2>/dev/null | grep -Eq '[:.]2222[[:space:]]'; then echo PORT_2222_LISTENING=yes; else echo PORT_2222_LISTENING=no; fi
if [ -d /usr/local/directadmin/data/users/imotion ]; then echo IMOTION_USER_EXISTS=yes; else echo IMOTION_USER_EXISTS=no; fi
printf 'DIRECTADMIN_USER_COUNT='
find /usr/local/directadmin/data/users -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' '
echo
SERVER_IP="$("$DA" config-get server_ip 2>/dev/null || true)"
printf 'SERVER_IP=%s\n' "$SERVER_IP"
if "$DA" api-url --help >/dev/null 2>&1; then echo ROOT_API_URL_CAPABLE=yes; else echo ROOT_API_URL_CAPABLE=no; fi
if "$DA" login-url --help >/dev/null 2>&1; then echo LOGIN_URL_CAPABLE=yes; else echo LOGIN_URL_CAPABLE=no; fi
if "$DA" taskq --help >/dev/null 2>&1; then echo TASKQ_CAPABLE=yes; else echo TASKQ_CAPABLE=no; fi
for d in ${domains}; do
  owner=''
  if [ -r /etc/virtual/domainowners ]; then owner="$(awk -F: -v x="$d" '$1==x{gsub(/[[:space:]]/,"",$2);print $2;exit}' /etc/virtual/domainowners || true)"; fi
  if [ -n "$owner" ]; then printf 'DOMAIN_OWNER %s=%s\n' "$d" "$owner"; else printf 'DOMAIN_OWNER %s=NONE\n' "$d"; fi
done
if [ -r /usr/local/directadmin/data/admin/ip.list ]; then
  printf 'ADMIN_IP_COUNT='; grep -Ec '^[0-9]+(\\.[0-9]+){3}$' /usr/local/directadmin/data/admin/ip.list || true
else
  echo ADMIN_IP_COUNT=0
fi
if command -v mariadb >/dev/null 2>&1; then echo DB_CLIENT=mariadb; elif command -v mysql >/dev/null 2>&1; then echo DB_CLIENT=mysql; else echo DB_CLIENT=NONE; fi
echo PRODUCTION_MUTATION=no
echo IMOTION_DA_PREFLIGHT_V2_COMPLETE=YES
`;
}

function imotionDaParseLines(s){
  const out={},owners={};

  for(const line of String(s).split(/\r?\n/)){
    if(line.startsWith('DOMAIN_OWNER ')){
      const x=line.slice(13);
      const i=x.indexOf('=');

      if(i>0)
        owners[x.slice(0,i)]=x.slice(i+1);

      continue;
    }

    const i=line.indexOf('=');

    if(i>0)
      out[line.slice(0,i)]=line.slice(i+1);
  }

  out.DOMAIN_OWNERS=owners;
  return out;
}

function imotionDirectAdminPreflightV2(){
  const key=imotionDaKeyscanBoundMaterial();
  const r=
    imotionDaRemoteBound(
      imotionDaPreflightScript(),
      key.known_hosts
    );
  const p=imotionDaParseLines(r.stdout);

  const domainOwners=
    Object.fromEntries(
      IMOTION_DA_DOMAINS.map(d=>[
        d,
        (p.DOMAIN_OWNERS?.[d]||'NONE')==='NONE'
          ? null
          : p.DOMAIN_OWNERS[d]
      ])
    );

  const cleanOwners=
    IMOTION_DA_DOMAINS.every(
      d=>domainOwners[d]===null
    );

  const serviceActive=
    p.DIRECTADMIN_SERVICE==='active';

  const port=
    p.PORT_2222_LISTENING==='yes';

  const userAbsent=
    p.IMOTION_USER_EXISTS==='no';

  const api=
    p.ROOT_API_URL_CAPABLE==='yes';

  const login=
    p.LOGIN_URL_CAPABLE==='yes';

  const taskq=
    p.TASKQ_CAPABLE==='yes';

  const db=
    p.DB_CLIENT &&
    p.DB_CLIENT!=='NONE'
      ? p.DB_CLIENT
      : null;

  const ok=
    r.status===0 &&
    p.DIRECTADMIN_BINARY==='yes' &&
    serviceActive &&
    port &&
    userAbsent &&
    api &&
    login &&
    taskq &&
    Boolean(db) &&
    Boolean(p.DIRECTADMIN_VERSION) &&
    Boolean(p.DIRECTADMIN_ADMIN) &&
    cleanOwners;

  return {
    ok,
    action:'imotion_directadmin_preflight_v2',
    read_only:true,
    target:IMOTION_DA_TARGET,
    host_key_bound:true,
    trust_model:'tofu-keyscan-session-bound',
    host_key_fingerprint:key.fingerprint,
    host_key_fingerprint_sha256:key.fingerprint,
    ssh_exit_code:r.status,
    hostname:p.HOSTNAME||null,
    directadmin_version:p.DIRECTADMIN_VERSION||null,
    admin_user:p.DIRECTADMIN_ADMIN||null,
    directadmin_admin:p.DIRECTADMIN_ADMIN||null,
    service_active:serviceActive,
    directadmin_service:p.DIRECTADMIN_SERVICE||null,
    port_2222_listening:port,
    user_imotion_absent:userAbsent,
    imotion_user_exists:!userAbsent,
    directadmin_user_count:Number(p.DIRECTADMIN_USER_COUNT||0),
    server_ip:p.SERVER_IP||null,
    api_url_capable:api,
    root_api_url_capable:api,
    login_url_capable:login,
    taskq_capable:taskq,
    admin_ip_count:Number(p.ADMIN_IP_COUNT||0),
    db_client:db,
    db_client_present:Boolean(db),
    domain_owners:domainOwners,
    domains:IMOTION_DA_DOMAINS.map(
      d=>({
        domain:d,
        owner:domainOwners[d]||'NONE'
      })
    ),
    all_imotion_domains_unowned:cleanOwners,
    production_mutation:false,
    database_mutation:false,
    service_control:false,
    stderr:
      r.status===0
        ? ''
        : r.stderr.slice(0,1200)
  };
}


export function registerProjectPlugin(mcp,context){
  let listProjectsHandler=null;

  const wrap=(name,h)=>
    name==='ops_execute'
      ? async a=>match(a)
        ? {content:[{
            type:'text',
            text:JSON.stringify(inventory())
          }]}
        : h(a)
      : h;

  const proxy=new Proxy(mcp,{
    get(t,p){
      if(p==='tool')
        return(n,d,s,h)=>{
          if(RETIRED_PROJECT_TOOLS.has(n))return undefined;
          if(n==='list_projects')listProjectsHandler=h;
          return t.tool(n,d,s,wrap(n,h));
        };

      if(p==='registerTool')
        return(n,c,h)=>{
          if(RETIRED_PROJECT_TOOLS.has(n))return undefined;
          if(n==='list_projects')listProjectsHandler=h;
          return t.registerTool(n,c,wrap(n,h));
        };

      const v=t[p];
      return typeof v==='function'?v.bind(t):v;
    }
  });

  const result=base.registerProjectPlugin(proxy,context);

  if(typeof listProjectsHandler!=='function')
    fail('project_exec_list_projects_handler_missing');

  mcp.registerTool(PROJECT_EXEC_NAME,{
    title:'Project Exec',

    description:
      'Canonical project-scoped command path for ordinary build, lint, test and safe Git workflow. '+
      'Executes one command inside the configured project root in a systemd sandbox. '+
      'Source-file edits belong in fast_dev_apply_v1; database and host/infra operations are rejected here.',

    inputSchema:{
      project:z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),

      command:z.string()
        .min(1)
        .max(20000),

      timeoutMs:z.number()
        .int()
        .min(1000)
        .max(1800000)
        .default(180000)
    },

    annotations:{
      readOnlyHint:false,
      destructiveHint:false,
      idempotentHint:false,
      openWorldHint:false
    }

  },async args=>{

    const projects=
      projectExecDecode(
        await listProjectsHandler({})
      );

    const rec=projects[args.project];

    if(!rec||typeof rec.root!=='string')
      fail('project_exec_project_unknown');

    const root=rec.root;

    const run=
      projectExecRun(
        root,
        args.command,
        args.timeoutMs??180000
      );

    return projectExecText({
      ok:run.exit_code===0,
      action:PROJECT_EXEC_NAME,
      project:args.project,
      command:args.command,
      root,

      exit_code:run.exit_code,
      signal:run.signal,
      error:run.error,
      stdout:run.stdout,
      stderr:run.stderr,

      execution_user:run.user,

      source_write_path:'fast_dev_apply_v1',
      database_path:'structured_db_execute',
      privileged_path:'ops_execute'
    });
  });

  mcp.registerTool(
    'imotion_directadmin_preflight_v2',
    {
      title:'iMotion DirectAdmin Preflight v2',
      description:
        'Fixed zero-input read-only preflight for DirectAdmin at the only allowed target. '+
        'The SSH session is bound to the same scanned ed25519 host key through a transient known_hosts file with StrictHostKeyChecking=yes. '+
        'Returns action-ready identity/capability/user/domain evidence and performs no mutation.',
      inputSchema:{},
      annotations:{
        readOnlyHint:true,
        destructiveHint:false,
        idempotentHint:true,
        openWorldHint:false
      }
    },
    async()=>({
      content:[{
        type:'text',
        text:JSON.stringify(
          imotionDirectAdminPreflightV2()
        )
      }]
    })
  );

  return result;
}
// IMOTION_DIRECTADMIN_SCHEMA_REPUBLISH_V2
