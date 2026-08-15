#!/usr/local/bin/prhm-node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='leadops_economics_inputs_foundation_v1';
const NODE='/usr/local/bin/prhm-node';

const FILES=Object.freeze({
  executor:'/opt/prhm-agent-selfmaint-exec/server.js',
  plugin:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  v4helper:'/opt/prhm-agent-selfmaint-exec/actions/mcp-candidate-schema-compare-v1.js',
  helper:'/opt/prhm-agent-selfmaint-exec/actions/leadops-economics-inputs-foundation-v1.js'
});

const EXPECTED=Object.freeze({"/opt/prhm-agent-selfmaint-exec/server.js":"ed7f03514d2d4b2eea6ec99805661e1cda5cdfa07b5672a39d3bca8fcce40c8b","/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js":"92d043ddea8456b713a9646f314ece8e82eef89fd4e4169a9d95cdd4732ac7a3","/opt/prhm-company-control-plane/config/approval-policy.json":"6558fcc0fc5f406ff79963c0ab2b6eddb1d1fd2cec2ebd26aa5318ffaff2c230","/opt/prhm-agent-selfmaint-exec/actions/mcp-candidate-schema-compare-v1.js":"a0acdd7876867df5b59aaf569ea118dc95278196fc9cf2cf926a0f5fed62df26","/opt/prhm-p0-shadow-worker/worker.js":"e08eaf993654709d4f3e182fc314d4828c2b5680a7c8613050735259768a9bd8","/opt/prhm-p0-shadow-worker/p0-engine.js":"91a056a654155962a8bdc6760fcbd32ff5d1f475579e4d57af00153937fb48f6"});
const HELPER_SHA='412901ae2e747c4d49ff5ea976f918d08784170945830502c34f599aa5e22152';
const HELPER_CONTENT="#!/usr/local/bin/prhm-node\n'use strict';\n\nconst fs=require('node:fs');\nconst path=require('node:path');\nconst crypto=require('node:crypto');\nconst cp=require('node:child_process');\n\nconst ACTION='leadops_economics_inputs_foundation_v1';\nconst WORKER='/opt/prhm-p0-shadow-worker/worker.js';\nconst ENGINE='/opt/prhm-p0-shadow-worker/p0-engine.js';\nconst MIGRATION='/opt/prhm-p0-fixed-executor/migrations/009_economic_input_facts.sql';\nconst PASSWORD_FILE='/etc/prhm-p0-db-helper/postgres_superuser_password';\nconst STATE_DIR='/var/lib/prhm-agent-selfmaint-exec/leadops-economics-inputs-foundation-v1';\nconst RESULT_FILE=path.join(STATE_DIR,'latest.json');\nconst LOCK_DIR=path.join(STATE_DIR,'lock');\nconst NODE='/usr/local/bin/prhm-node';\nconst PSQL='/usr/bin/psql';\nconst EXPECTED_WORKER_SHA='e08eaf993654709d4f3e182fc314d4828c2b5680a7c8613050735259768a9bd8';\nconst EXPECTED_ENGINE_SHA='91a056a654155962a8bdc6760fcbd32ff5d1f475579e4d57af00153937fb48f6';\nconst MIGRATION_SHA='dfaba6d8f454a99cdeb9286a40514ee56ae32a6f4829b7e52d7be42798c3a148';\nconst MIGRATION_CONTENT=\"BEGIN;\\n\\nCREATE TABLE marketplace.economic_input_facts (\\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\\n  input_name text NOT NULL CHECK (\\n    input_name IN (\\n      'recommendedPrice',\\n      'hardFloor',\\n      'platformMinimum',\\n      'minimumMarginPrice',\\n      'platformFee',\\n      'deliveryCost',\\n      'aiOpsCost',\\n      'paymentFee',\\n      'riskReserve',\\n      'winProbability',\\n      'humanHours'\\n    )\\n  ),\\n  value numeric NOT NULL,\\n  verified boolean NOT NULL DEFAULT false,\\n  provenance jsonb NOT NULL,\\n  source_id uuid NULL REFERENCES marketplace.sources(id) ON DELETE RESTRICT,\\n  service_category text NULL,\\n  opportunity_id uuid NULL REFERENCES marketplace.opportunities(id) ON DELETE RESTRICT,\\n  observed_at timestamptz NOT NULL DEFAULT now(),\\n  expires_at timestamptz NULL,\\n  created_at timestamptz NOT NULL DEFAULT now(),\\n  updated_at timestamptz NOT NULL DEFAULT now(),\\n  CHECK (jsonb_typeof(provenance) = 'object'),\\n  CHECK (provenance <> '{}'::jsonb),\\n  CHECK (provenance ? 'source'),\\n  CHECK (\\n    input_name NOT IN (\\n      'recommendedPrice',\\n      'hardFloor',\\n      'platformMinimum',\\n      'minimumMarginPrice',\\n      'platformFee',\\n      'deliveryCost',\\n      'aiOpsCost',\\n      'paymentFee',\\n      'riskReserve'\\n    )\\n    OR value >= 0\\n  ),\\n  CHECK (\\n    input_name <> 'winProbability'\\n    OR (value >= 0 AND value <= 1)\\n  ),\\n  CHECK (\\n    input_name <> 'humanHours'\\n    OR value > 0\\n  ),\\n  CHECK (\\n    expires_at IS NULL\\n    OR expires_at > observed_at\\n  )\\n);\\n\\nCREATE INDEX ix_economic_input_facts_resolver\\nON marketplace.economic_input_facts (\\n  input_name,\\n  opportunity_id,\\n  source_id,\\n  service_category,\\n  observed_at DESC,\\n  created_at DESC\\n)\\nWHERE verified = true;\\n\\nCREATE VIEW marketplace.resolved_economic_inputs\\nWITH (security_barrier = true)\\nAS\\nSELECT\\n  o.id AS opportunity_id,\\n  r.input_name,\\n  r.value,\\n  r.provenance,\\n  r.fact_id,\\n  r.specificity,\\n  r.observed_at,\\n  r.expires_at\\nFROM marketplace.opportunities o\\nJOIN LATERAL (\\n  SELECT DISTINCT ON (f.input_name)\\n    f.id AS fact_id,\\n    f.input_name,\\n    f.value,\\n    f.provenance,\\n    f.observed_at,\\n    f.expires_at,\\n    (\\n      CASE WHEN f.opportunity_id IS NOT NULL THEN 100 ELSE 0 END +\\n      CASE WHEN f.source_id IS NOT NULL THEN 10 ELSE 0 END +\\n      CASE WHEN f.service_category IS NOT NULL THEN 1 ELSE 0 END\\n    ) AS specificity\\n  FROM marketplace.economic_input_facts f\\n  WHERE f.verified = true\\n    AND f.observed_at <= now()\\n    AND (f.expires_at IS NULL OR f.expires_at > now())\\n    AND (f.opportunity_id IS NULL OR f.opportunity_id = o.id)\\n    AND (f.source_id IS NULL OR f.source_id = o.source_id)\\n    AND (f.service_category IS NULL OR f.service_category = o.service_category)\\n  ORDER BY\\n    f.input_name,\\n    specificity DESC,\\n    f.observed_at DESC,\\n    f.created_at DESC,\\n    f.id DESC\\n) r ON true;\\n\\nREVOKE ALL ON TABLE marketplace.economic_input_facts FROM PUBLIC;\\nREVOKE ALL ON TABLE marketplace.economic_input_facts FROM leadops_app;\\nREVOKE ALL ON TABLE marketplace.economic_input_facts FROM leadops_p0_shadow;\\n\\nREVOKE ALL ON TABLE marketplace.resolved_economic_inputs FROM PUBLIC;\\nREVOKE ALL ON TABLE marketplace.resolved_economic_inputs FROM leadops_app;\\nREVOKE ALL ON TABLE marketplace.resolved_economic_inputs FROM leadops_p0_shadow;\\n\\nGRANT SELECT ON TABLE marketplace.resolved_economic_inputs TO leadops_p0_shadow;\\n\\nCOMMIT;\\n\";\n\nconst REQUIRED_ECONOMICS=[\n  'recommendedPrice',\n  'hardFloor',\n  'platformMinimum',\n  'minimumMarginPrice',\n  'platformFee',\n  'deliveryCost',\n  'aiOpsCost',\n  'paymentFee',\n  'riskReserve'\n];\n\nfunction shaBuffer(b){return crypto.createHash('sha256').update(b).digest('hex');}\nfunction shaFile(f){return shaBuffer(fs.readFileSync(f));}\nfunction fail(m){throw new Error(m);}\nfunction countOf(text,needle){return text.split(needle).length-1;}\nfunction replaceOnce(text,needle,replacement,label){\n  const i=text.indexOf(needle);\n  if(i<0)fail('anchor_missing:'+label);\n  if(text.indexOf(needle,i+needle.length)>=0)fail('anchor_not_unique:'+label);\n  return text.slice(0,i)+replacement+text.slice(i+needle.length);\n}\nfunction exec(file,args,{input,env,allowFailure=false,timeout=30000}={}){\n  const r=cp.spawnSync(file,args,{\n    input,\n    env:env||process.env,\n    encoding:'utf8',\n    timeout,\n    maxBuffer:16*1024*1024,\n    stdio:['pipe','pipe','pipe']\n  });\n  if(r.error)fail('exec_error:'+path.basename(file)+':'+r.error.message);\n  if(!allowFailure&&r.status!==0)\n    fail('exec_failed:'+path.basename(file)+':'+r.status+':'+String(r.stderr||r.stdout||'').slice(0,2000));\n  return r;\n}\nfunction psql(sql,{readOnly=false}={}){\n  const password=fs.readFileSync(PASSWORD_FILE,'utf8').trim();\n  if(!password)fail('database_password_empty');\n  const env={\n    ...process.env,\n    PGPASSWORD:password,\n    PGOPTIONS:readOnly\n      ? '-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=2000'\n      : '-c statement_timeout=30000 -c lock_timeout=3000'\n  };\n  try{\n    return String(exec(PSQL,[\n      '-X','-At','-v','ON_ERROR_STOP=1',\n      '-h','127.0.0.1','-p','55434',\n      '-U','leadops_admin','-d','leadops'\n    ],{input:sql,env,timeout:60000}).stdout||'').trim();\n  }finally{\n    delete env.PGPASSWORD;\n  }\n}\nfunction dbState(){\n  return psql(`\nWITH expected(flag,enabled) AS (\n  VALUES\n    ('P0_DECISION_ENABLED',false),\n    ('P0_SHADOW_MODE',true),\n    ('AUTO_PROPOSAL_ENABLED',false),\n    ('PROPOSAL_AUTO_SEND_ENABLED',false),\n    ('FOLLOWUP_ENABLED',false),\n    ('AUTO_NEGOTIATION_ENABLED',false),\n    ('AUTO_ASSIGNMENT_ENABLED',false),\n    ('AUTO_QA_ENABLED',false),\n    ('AUTO_DELIVERY_ENABLED',false),\n    ('AUTO_BILLING_ENABLED',false),\n    ('AUTO_PAYMENT_MATCH_ENABLED',false),\n    ('UPSELL_ENABLED',false),\n    ('REACTIVATION_ENABLED',false)\n)\nSELECT\n  (SELECT count(*) FROM automation.p0_feature_flags)||'|'||\n  (SELECT count(*) FROM expected e\n    LEFT JOIN automation.p0_feature_flags f ON f.flag=e.flag\n    WHERE f.flag IS NULL OR f.enabled IS DISTINCT FROM e.enabled)||'|'||\n  (SELECT count(*) FROM marketplace.opportunity_decisions)||'|'||\n  CASE WHEN to_regclass('marketplace.economic_input_facts') IS NULL THEN 0 ELSE 1 END||'|'||\n  CASE WHEN to_regclass('marketplace.resolved_economic_inputs') IS NULL THEN 0 ELSE 1 END;\n`,{readOnly:true});\n}\nfunction parseState(s){\n  const p=String(s).trim().split('|').map(Number);\n  if(p.length!==5||p.some(x=>!Number.isFinite(x)))fail('db_state_invalid:'+s);\n  return {flags:p[0],mismatches:p[1],decisions:p[2],facts:p[3],resolved:p[4]};\n}\nfunction verifyBaseState(expectAbsent=true){\n  const s=parseState(dbState());\n  if(s.flags!==13||s.mismatches!==0)fail('p0_flags_not_safe:'+JSON.stringify(s));\n  if(expectAbsent&&(s.facts!==0||s.resolved!==0))fail('economics_objects_already_present:'+JSON.stringify(s));\n  if(!expectAbsent&&(s.facts!==1||s.resolved!==1))fail('economics_objects_missing:'+JSON.stringify(s));\n  return s;\n}\nfunction verifyEconomicsPost(before){\n  const state=verifyBaseState(false);\n  if(state.decisions!==before.decisions)fail('decision_count_changed:'+before.decisions+':'+state.decisions);\n  const raw=psql(`\nSELECT\n  (SELECT count(*) FROM marketplace.economic_input_facts)||'|'||\n  has_table_privilege('leadops_app','marketplace.economic_input_facts','SELECT')::int||'|'||\n  has_table_privilege('leadops_p0_shadow','marketplace.economic_input_facts','SELECT')::int||'|'||\n  has_table_privilege('leadops_p0_shadow','marketplace.resolved_economic_inputs','SELECT')::int;\n`,{readOnly:true});\n  const p=raw.split('|').map(Number);\n  if(p.length!==4||p[0]!==0||p[1]!==0||p[2]!==0||p[3]!==1)\n    fail('economics_privilege_or_fact_count_failed:'+raw);\n  return {\n    ...state,\n    fact_rows:p[0],\n    leadops_app_raw_select:false,\n    shadow_raw_select:false,\n    shadow_resolved_select:true\n  };\n}\nconst ROLLBACK_SQL=`BEGIN;\nDO $$\nDECLARE n bigint;\nBEGIN\n  IF to_regclass('marketplace.economic_input_facts') IS NULL\n     OR to_regclass('marketplace.resolved_economic_inputs') IS NULL\n  THEN\n    RAISE EXCEPTION 'economics rollback objects missing';\n  END IF;\n  SELECT count(*) INTO n FROM marketplace.economic_input_facts;\n  IF n <> 0 THEN\n    RAISE EXCEPTION 'economics rollback blocked: facts exist';\n  END IF;\nEND $$;\nDROP VIEW marketplace.resolved_economic_inputs;\nDROP TABLE marketplace.economic_input_facts;\nCOMMIT;`;\n\nfunction buildWorker(input){\n  if(shaBuffer(Buffer.from(input))!==EXPECTED_WORKER_SHA)\n    fail('worker_sha_mismatch');\n\n  let out=input;\n\n  out=replaceOnce(\n    out,\n    `        o.budget_toman_max,\n\n        e.id`,\n    `        o.budget_toman_max,\n\n        coalesce(\n          econ.economics,\n          '{}'::jsonb\n        ) economics,\n\n        e.id`,\n    'candidate_select_economics'\n  );\n\n  out=replaceOnce(\n    out,\n    `      join latest e\n        on\n          e.opportunity_id =\n          o.id\n\n      where not exists (`,\n    `      join latest e\n        on\n          e.opportunity_id =\n          o.id\n\n      left join lateral (\n\n        select\n          jsonb_object_agg(\n            r.input_name,\n            jsonb_build_object(\n              'value', r.value,\n              'provenance', r.provenance,\n              'fact_id', r.fact_id,\n              'specificity', r.specificity,\n              'observed_at', r.observed_at,\n              'expires_at', r.expires_at\n            )\n          ) economics\n\n        from\n          marketplace.resolved_economic_inputs r\n\n        where\n          r.opportunity_id =\n            o.id\n\n      ) econ\n        on true\n\n      where not exists (`,\n    'candidate_join_economics'\n  );\n\n  out=replaceOnce(\n    out,\n    `  const rejection =\n    String(\n      row.rejection_reason ||\n      ''\n    ).toLowerCase();\n\n  return {`,\n    `  const rejection =\n    String(\n      row.rejection_reason ||\n      ''\n    ).toLowerCase();\n\n  const economics =\n    row.economics &&\n    typeof row.economics === 'object' &&\n    !Array.isArray(row.economics)\n      ? row.economics\n      : {};\n\n  function economicFact(name) {\n\n    const raw =\n      economics[name];\n\n    if (\n      !raw ||\n      typeof raw !== 'object' ||\n      Array.isArray(raw) ||\n      !raw.provenance ||\n      typeof raw.provenance !== 'object' ||\n      Array.isArray(raw.provenance)\n    ) {\n      return null;\n    }\n\n    const value =\n      Number(raw.value);\n\n    if (!Number.isFinite(value)) {\n      return null;\n    }\n\n    return {\n      ...raw,\n      value\n    };\n  }\n\n  function economicValue(name) {\n    const f = economicFact(name);\n    return f ? f.value : undefined;\n  }\n\n  const economicsFacts = {};\n  for (const name of ${JSON.stringify(REQUIRED_ECONOMICS)}) {\n    const f = economicFact(name);\n    if (f) economicsFacts[name] = f;\n  }\n\n  for (const name of ['winProbability','humanHours']) {\n    const f = economicFact(name);\n    if (f) economicsFacts[name] = f;\n  }\n\n  const economicsMissing =\n    ${JSON.stringify(REQUIRED_ECONOMICS)}\n      .filter(\n        name =>\n          !economicFact(name)\n      );\n\n  return {`,\n    'map_input_economics_prelude'\n  );\n\n  const map={\n    recommendedPrice:'recommendedPrice',\n    hardFloor:'hardFloor',\n    platformMinimum:'platformMinimum',\n    minimumMarginPrice:'minimumMarginPrice',\n    platformFee:'platformFee',\n    deliveryCost:'deliveryCost',\n    aiOpsCost:'aiOpsCost',\n    paymentFee:'paymentFee',\n    riskReserve:'riskReserve',\n    winProbability:'winProbability',\n    humanHours:'humanHours'\n  };\n  for(const [field,name] of Object.entries(map)){\n    out=replaceOnce(\n      out,\n      `    ${field}:\n      undefined,`,\n      `    ${field}:\n      economicValue(\n        '${name}'\n      ),`,\n      'map_field_'+field\n    );\n  }\n\n  out=replaceOnce(\n    out,\n    `    platformQuotaRemaining:\n      undefined\n  };`,\n    `    platformQuotaRemaining:\n      undefined,\n\n    _economicsMissing:\n      economicsMissing,\n\n    _economicsFacts:\n      economicsFacts\n  };`,\n    'map_internal_economics'\n  );\n\n  out=replaceOnce(\n    out,\n    `      const output =\n        evaluateOpportunity(\n          input\n        );`,\n    `      const baseOutput =\n        evaluateOpportunity(\n          input\n        );\n\n      const economicsIncomplete =\n        Array.isArray(\n          input._economicsMissing\n        ) &&\n        input._economicsMissing.length > 0;\n\n      const preservesSafetyBlock =\n        [\n          'REJECT_FALSE_POSITIVE',\n          'STALE',\n          'CHANNEL_BLOCKED'\n        ].includes(\n          baseOutput.decision\n        );\n\n      const output =\n        economicsIncomplete &&\n        !preservesSafetyBlock\n          ? {\n              ...baseOutput,\n              decision:\n                'ASK_CLARIFICATION',\n              reason:\n                'economics_inputs_incomplete',\n              economicFloor:\n                null,\n              finalBid:\n                null,\n              netProfit:\n                null,\n              margin:\n                null,\n              expectedProfit:\n                null,\n              expectedProfitPerHumanHour:\n                null,\n              autoSendAllowed:\n                false\n            }\n          : baseOutput;`,\n    'evaluate_completeness_gate'\n  );\n\n  out=replaceOnce(\n    out,\n    `'prhm.p0-shadow-input.v1'`,\n    `'prhm.p0-shadow-input.v2-economics'`,\n    'snapshot_schema_version'\n  );\n\n  for(const field of Object.keys(map)){\n    out=replaceOnce(\n      out,\n      `            ${field}:\n              null,`,\n      `            ${field}:\n              item.input\n                .${field} ?? null,`,\n      'snapshot_'+field\n    );\n  }\n\n  out=replaceOnce(\n    out,\n    `            platformQuotaRemaining:\n              null\n          },`,\n    `            platformQuotaRemaining:\n              null\n          },\n\n          economics: {\n\n            required:\n              ${JSON.stringify(REQUIRED_ECONOMICS)},\n\n            missing:\n              item.input\n                ._economicsMissing,\n\n            complete:\n              item.input\n                ._economicsMissing\n                .length === 0,\n\n            facts:\n              item.input\n                ._economicsFacts\n          },`,\n    'snapshot_economics_provenance'\n  );\n\n  if(!out.includes('economics_inputs_incomplete'))fail('economics_gate_missing');\n  if(!out.includes('prhm.p0-shadow-input.v2-economics'))fail('economics_snapshot_schema_missing');\n  return out;\n}\n\nfunction preflight(){\n  if(!fs.existsSync(WORKER)||!fs.existsSync(ENGINE))fail('worker_or_engine_missing');\n  if(shaFile(WORKER)!==EXPECTED_WORKER_SHA)fail('worker_sha_mismatch_live');\n  if(shaFile(ENGINE)!==EXPECTED_ENGINE_SHA)fail('engine_sha_mismatch_live');\n  if(fs.existsSync(MIGRATION))fail('migration_009_already_exists');\n  if(shaBuffer(Buffer.from(MIGRATION_CONTENT))!==MIGRATION_SHA)fail('migration_sha_mismatch_embedded');\n\n  const before=verifyBaseState(true);\n\n  const source=fs.readFileSync(WORKER,'utf8');\n  const candidate=buildWorker(source);\n  const tmp='/tmp/prhm-p0-shadow-worker-economics-'+process.pid+'.js';\n  fs.writeFileSync(tmp,candidate,{mode:0o600});\n  try{\n    exec(NODE,['--check',tmp],{timeout:15000});\n  }finally{\n    try{fs.unlinkSync(tmp)}catch{}\n  }\n\n  return {\n    ok:true,\n    schema_version:'prhm.host-action-preflight.v1',\n    action:ACTION,\n    worker_before_sha256:EXPECTED_WORKER_SHA,\n    worker_candidate_sha256:shaBuffer(Buffer.from(candidate)),\n    engine_sha256:EXPECTED_ENGINE_SHA,\n    migration_sha256:MIGRATION_SHA,\n    database_before:before,\n    economics_required:REQUIRED_ECONOMICS,\n    decision_version_unchanged:true,\n    facts_seeded:false,\n    p0_live:false,\n    proposal_send:false,\n    bid_send:false,\n    production_mutation:false\n  };\n}\n\nfunction atomicReplace(file,text){\n  const st=fs.statSync(file);\n  const tmp=file+'.economics-'+process.pid+'-'+Date.now()+'.tmp';\n  fs.writeFileSync(tmp,text,{mode:st.mode&0o777});\n  fs.chownSync(tmp,st.uid,st.gid);\n  fs.renameSync(tmp,file);\n}\n\nfunction main(){\n  if(process.argv.includes('--preflight-only')){\n    console.log(JSON.stringify(preflight()));\n    return;\n  }\n  if(process.argv.length>2)fail('unexpected_arguments');\n\n  fs.mkdirSync(STATE_DIR,{recursive:true,mode:0o700});\n  try{\n    fs.mkdirSync(LOCK_DIR,{mode:0o700});\n  }catch(e){\n    if(e.code==='EEXIST')fail('economics_foundation_already_running');\n    throw e;\n  }\n\n  let backup=null;\n  let migrationCreated=false;\n  let migrationApplied=false;\n  let workerPatched=false;\n\n  try{\n    const pf=preflight();\n    const before=pf.database_before;\n    const source=fs.readFileSync(WORKER,'utf8');\n    const candidate=buildWorker(source);\n\n    backup=path.join(STATE_DIR,'worker-'+Date.now()+'.bak');\n    fs.copyFileSync(WORKER,backup,fs.constants.COPYFILE_EXCL);\n    fs.chmodSync(backup,0o600);\n\n    fs.writeFileSync(MIGRATION,MIGRATION_CONTENT,{flag:'wx',mode:0o600});\n    migrationCreated=true;\n    if(shaFile(MIGRATION)!==MIGRATION_SHA)fail('staged_migration_sha_mismatch');\n\n    psql(MIGRATION_CONTENT);\n    migrationApplied=true;\n\n    atomicReplace(WORKER,candidate);\n    workerPatched=true;\n\n    exec(NODE,['--check',WORKER],{timeout:15000});\n\n    const dry=exec(NODE,[WORKER,'--dry-run'],{timeout:90000});\n    const dryText=String(dry.stdout||'');\n    if(!dryText.includes('DECISION_INSERTS=0')||!dryText.includes('RESULT=DRY_RUN_SUCCESS'))\n      fail('worker_dry_run_failed:'+dryText.slice(-2000));\n\n    const after=verifyEconomicsPost(before);\n\n    const result={\n      schema_version:'prhm.host-action-result.v1',\n      ok:true,\n      action:ACTION,\n      finished_at:new Date().toISOString(),\n      migration_sha256:MIGRATION_SHA,\n      worker_before_sha256:EXPECTED_WORKER_SHA,\n      worker_after_sha256:shaFile(WORKER),\n      engine_sha256:EXPECTED_ENGINE_SHA,\n      facts_count:after.fact_rows,\n      decision_count_before:before.decisions,\n      decision_count_after:after.decisions,\n      flags_safe:true,\n      raw_fact_access:false,\n      resolved_view_access:true,\n      economics_required:REQUIRED_ECONOMICS,\n      completeness_gate:'economics_inputs_incomplete',\n      decision_version_unchanged:true,\n      dry_run:true,\n      decision_inserts:0,\n      database_mutation:true,\n      business_mutation:false,\n      facts_seeded:false,\n      p0_live:false,\n      proposal_send:false,\n      bid_send:false,\n      rollback_performed:false,\n      backup_path:backup\n    };\n\n    const tmp=RESULT_FILE+'.'+process.pid+'.tmp';\n    fs.writeFileSync(tmp,JSON.stringify(result)+'\\n',{mode:0o600});\n    fs.renameSync(tmp,RESULT_FILE);\n    console.log(JSON.stringify(result));\n  }catch(error){\n    const rollbackErrors=[];\n\n    if(workerPatched&&backup){\n      try{\n        atomicReplace(WORKER,fs.readFileSync(backup,'utf8'));\n      }catch(e){rollbackErrors.push('worker:'+e.message)}\n    }\n\n    if(migrationApplied){\n      try{\n        psql(ROLLBACK_SQL);\n      }catch(e){rollbackErrors.push('database:'+e.message)}\n    }\n\n    if(migrationCreated){\n      try{fs.unlinkSync(MIGRATION)}catch(e){rollbackErrors.push('migration_file:'+e.message)}\n    }\n\n    try{\n      const state=verifyBaseState(true);\n      if(state.mismatches!==0)rollbackErrors.push('flags_mismatch_after_rollback');\n    }catch(e){rollbackErrors.push('postrollback_verify:'+e.message)}\n\n    if(rollbackErrors.length)\n      fail('economics_foundation_failed_and_rollback_incomplete:'+error.message+':'+rollbackErrors.join('|'));\n\n    fail('economics_foundation_failed_rolled_back:'+error.message);\n  }finally{\n    try{fs.rmdirSync(LOCK_DIR)}catch{}\n  }\n}\n\nmain();\n";

function shaBuffer(b){return crypto.createHash('sha256').update(b).digest('hex');}
function shaFile(f){return shaBuffer(fs.readFileSync(f));}
function fail(m){throw new Error(m);}
function replaceOnce(text,needle,replacement,label){
  const i=text.indexOf(needle);
  if(i<0)fail('anchor_missing:'+label);
  if(text.indexOf(needle,i+needle.length)>=0)fail('anchor_not_unique:'+label);
  return text.slice(0,i)+replacement+text.slice(i+needle.length);
}
function exec(file,args,{allowFailure=false,timeout=30000}={}){
  const r=cp.spawnSync(file,args,{encoding:'utf8',timeout,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});
  if(r.error)fail('exec_error:'+path.basename(file)+':'+r.error.message);
  if(!allowFailure&&r.status!==0)
    fail('exec_failed:'+path.basename(file)+':'+r.status+':'+String(r.stderr||r.stdout||'').slice(0,2000));
  return r;
}
function systemctl(args){return exec('/usr/bin/systemctl',args,{timeout:45000});}
function waitActive(unit){
  for(let i=0;i<50;i++){
    const r=exec('/usr/bin/systemctl',['is-active',unit],{allowFailure:true,timeout:10000});
    if(String(r.stdout||'').trim()==='active')return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,400);
  }
  return false;
}
function atomicReplace(file,text){
  const st=fs.statSync(file);
  const tmp=file+'.host-action-v5-'+process.pid+'-'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,text,{mode:st.mode&0o777});
  fs.chownSync(tmp,st.uid,st.gid);
  fs.renameSync(tmp,file);
}
function syntaxCheck(name,text,isModule=false){
  const tmp='/tmp/prhm-v5-'+path.basename(name)+'-'+process.pid+(isModule?'.mjs':'.js');
  fs.writeFileSync(tmp,text,{mode:0o600});
  try{exec(NODE,['--check',tmp],{timeout:15000});}
  finally{try{fs.unlinkSync(tmp)}catch{}}
}
function patchExecutor(src){
  src=replaceOnce(
    src,
    "  mcp_candidate_schema_compare_v1:{operation:'host_action.mcp_candidate_schema_compare_v1',kind:'mcp_candidate_schema_compare_v1'}\n});",
    "  mcp_candidate_schema_compare_v1:{operation:'host_action.mcp_candidate_schema_compare_v1',kind:'mcp_candidate_schema_compare_v1'},\n  leadops_economics_inputs_foundation_v1:{operation:'host_action.leadops_economics_inputs_foundation_v1',kind:'leadops_economics_inputs_foundation_v1'}\n});",
    'executor_spec'
  );

  src=replaceOnce(
    src,
    "function verifyProcessSandboxV2(){",
    `const LEADOPS_ECONOMICS_FOUNDATION_HELPER='/opt/prhm-agent-selfmaint-exec/actions/leadops-economics-inputs-foundation-v1.js';
const LEADOPS_ECONOMICS_FOUNDATION_RESULT='/var/lib/prhm-agent-selfmaint-exec/leadops-economics-inputs-foundation-v1/latest.json';
function applyLeadOpsEconomicsInputsFoundationV1(){
  if(!fs.existsSync(LEADOPS_ECONOMICS_FOUNDATION_HELPER))throw new Error('leadops_economics_foundation_helper_missing');
  try{if(fs.existsSync(LEADOPS_ECONOMICS_FOUNDATION_RESULT))fs.unlinkSync(LEADOPS_ECONOMICS_FOUNDATION_RESULT)}catch{}
  const unit='prhm-leadops-economics-inputs-foundation-v1-'+Date.now();
  const args=[
    '--wait',
    '--unit='+unit,
    '--property=Type=oneshot',
    '--property=UMask=0077',
    '--property=NoNewPrivileges=true',
    '--property=PrivateTmp=true',
    '--property=ProtectSystem=full',
    '--property=ProtectHome=read-only',
    '--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
    '--property=ReadWritePaths=/opt/prhm-p0-shadow-worker /opt/prhm-p0-fixed-executor/migrations /var/lib/prhm-agent-selfmaint-exec /run/prhm-p0-shadow-worker',
    '--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    '/usr/local/bin/prhm-node',
    LEADOPS_ECONOMICS_FOUNDATION_HELPER
  ];
  cp.execFileSync('/usr/bin/systemd-run',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:240000});
  if(!fs.existsSync(LEADOPS_ECONOMICS_FOUNDATION_RESULT))throw new Error('leadops_economics_foundation_result_missing');
  const result=readJson(LEADOPS_ECONOMICS_FOUNDATION_RESULT);
  if(
    result.ok!==true ||
    result.action!=='leadops_economics_inputs_foundation_v1' ||
    result.schema_version!=='prhm.host-action-result.v1' ||
    result.facts_count!==0 ||
    result.business_mutation!==false ||
    result.p0_live!==false ||
    result.proposal_send!==false ||
    result.bid_send!==false
  )throw new Error('leadops_economics_foundation_result_invalid');
  return result;
}
function verifyProcessSandboxV2(){`,
    'executor_helper'
  );

  src=replaceOnce(
    src,
    "if(action==='mcp_candidate_schema_compare_v1')return applyMcpCandidateSchemaCompareV1();verifyHostActionV2Dependencies(action);",
    "if(action==='mcp_candidate_schema_compare_v1')return applyMcpCandidateSchemaCompareV1();if(action==='leadops_economics_inputs_foundation_v1')return applyLeadOpsEconomicsInputsFoundationV1();verifyHostActionV2Dependencies(action);",
    'executor_apply_branch'
  );

  src=replaceOnce(
    src,
    "version: '1.4.0-host-actions-v2-mcp-candidate-schema-compare'",
    "version: '1.5.0-host-actions-v2-leadops-economics-foundation'",
    'executor_version'
  );

  return src;
}
function patchPlugin(src){
  src=replaceOnce(
    src,
    "const HostActionV2=z.enum(['agent_api_process_sandbox_v1','agent_api_filesystem_confinement_v1','agent_api_capability_minimize_v1','leadops_language_gate_v1','mcp_candidate_schema_compare_v1']);",
    "const HostActionV2=z.enum(['agent_api_process_sandbox_v1','agent_api_filesystem_confinement_v1','agent_api_capability_minimize_v1','leadops_language_gate_v1','mcp_candidate_schema_compare_v1','leadops_economics_inputs_foundation_v1']);",
    'plugin_enum'
  );
  src=replaceOnce(
    src,
    "Includes Agent API hardening, the no-input LeadOps language gate, and the no-input MCP candidate schema comparison.",
    "Includes Agent API hardening, the no-input LeadOps language gate, the no-input MCP candidate schema comparison, and the fixed LeadOps Economics Inputs foundation.",
    'plugin_description'
  );
  return src;
}
function patchPolicy(src){
  const p=JSON.parse(src);
  if(!p.operations||typeof p.operations!=='object')fail('policy_operations_missing');
  if(p.operations['host_action.leadops_economics_inputs_foundation_v1'])fail('policy_operation_already_present');
  p.operations['host_action.leadops_economics_inputs_foundation_v1']={level:4};
  if(!Array.isArray(p.typed_scopes))fail('policy_typed_scopes_missing');
  if(p.typed_scopes.some(x=>x&&x.action===ACTION))fail('policy_scope_already_present');
  p.typed_scopes.push({
    tool:'host_action_v2_apply',
    project:'control_plane',
    environment:'production',
    action:ACTION,
    risk:'critical',
    operation:'host_action.leadops_economics_inputs_foundation_v1',
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
  });
  p.version='2026-08-14.1-leadops-economics-foundation-v1';
  return JSON.stringify(p,null,2)+'\n';
}
function patchV4Helper(src,newPluginSha){
  return replaceOnce(
    src,
    "const EXPECTED_POSTINSTALL_PLUGIN_SHA='92d043ddea8456b713a9646f314ece8e82eef89fd4e4169a9d95cdd4732ac7a3';",
    "const EXPECTED_POSTINSTALL_PLUGIN_SHA='"+newPluginSha+"';",
    'v4_expected_plugin_sha'
  );
}
function curlHealth(args,label){
  let lastError=null;
  for(let i=0;i<50;i++){
    try{
      const r=exec('/usr/bin/curl',args,{timeout:10000});
      return JSON.parse(String(r.stdout||'{}'));
    }catch(error){
      lastError=error;
      if(i<49)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200);
    }
  }
  fail(label+'_health_not_ready:'+String(lastError?.message||lastError||'unknown'));
}
function loopbackHealth(port){
  return curlHealth(['-fsS','http://127.0.0.1:'+port+'/health'],'loopback');
}
function unixHealth(socket){
  return curlHealth(['-fsS','--unix-socket',socket,'http://localhost/health'],'unix');
}

function main(){
  const args=process.argv.slice(2);
  if(args.length>1)fail('unexpected_arguments');
  if(args.length===1&&args[0]!=='--preflight-only')fail('unexpected_argument:'+args[0]);
  const preflightOnly=args[0]==='--preflight-only';

  if(process.getuid&&process.getuid()!==0)fail('must_run_as_root');

  for(const [f,expected] of Object.entries(EXPECTED)){
    if(!fs.existsSync(f))fail('baseline_file_missing:'+f);
    const actual=shaFile(f);
    if(actual!==expected)fail('baseline_sha_mismatch:'+f+':'+actual);
  }
  if(fs.existsSync(FILES.helper))fail('v5_helper_already_exists');
  if(shaBuffer(Buffer.from(HELPER_CONTENT))!==HELPER_SHA)fail('embedded_helper_sha_mismatch');

  const original={
    executor:fs.readFileSync(FILES.executor,'utf8'),
    plugin:fs.readFileSync(FILES.plugin,'utf8'),
    policy:fs.readFileSync(FILES.policy,'utf8'),
    v4helper:fs.readFileSync(FILES.v4helper,'utf8')
  };

  const candidate={
    executor:patchExecutor(original.executor),
    plugin:patchPlugin(original.plugin),
    policy:patchPolicy(original.policy),
    v4helper:null
  };
  const pluginSha=shaBuffer(Buffer.from(candidate.plugin));
  candidate.v4helper=patchV4Helper(original.v4helper,pluginSha);

  syntaxCheck(FILES.executor,candidate.executor,false);
  syntaxCheck(FILES.plugin,candidate.plugin,true);
  JSON.parse(candidate.policy);
  syntaxCheck(FILES.v4helper,candidate.v4helper,false);
  syntaxCheck(FILES.helper,HELPER_CONTENT,false);

  const helperTmp='/tmp/prhm-host-action-v5-helper-preflight-'+process.pid+'.js';
  fs.writeFileSync(helperTmp,HELPER_CONTENT,{mode:0o700});
  let helperPreflight;
  try{
    const r=exec(NODE,[helperTmp,'--preflight-only'],{timeout:90000});
    helperPreflight=JSON.parse(String(r.stdout||'{}').trim());
  }finally{
    try{fs.unlinkSync(helperTmp)}catch{}
  }
  if(helperPreflight.ok!==true||helperPreflight.production_mutation!==false)
    fail('helper_preflight_invalid:'+JSON.stringify(helperPreflight));

  const preflightReport={
    ok:true,
    schema_version:'prhm.host-action-bootstrap-preflight.v1',
    preflight_only:preflightOnly,
    action:ACTION,
    current_hashes:EXPECTED,
    candidate_hashes:{
      executor:shaBuffer(Buffer.from(candidate.executor)),
      plugin:pluginSha,
      policy:shaBuffer(Buffer.from(candidate.policy)),
      v4helper:shaBuffer(Buffer.from(candidate.v4helper)),
      helper:HELPER_SHA
    },
    target_version:'1.5.0-host-actions-v2-leadops-economics-foundation',
    helper_preflight:helperPreflight,
    host_action_v4_preserved:true,
    economics_foundation_executed:false,
    migration_009_executed:false,
    production_mutation:false
  };

  if(preflightOnly){
    console.log(JSON.stringify(preflightReport));
    return;
  }

  const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);
  const backupDir='/var/backups/prhm-host-actions-v5-leadops-economics-foundation-'+stamp;
  fs.mkdirSync(backupDir,{recursive:true,mode:0o700});

  for(const key of ['executor','plugin','policy','v4helper']){
    const dst=path.join(backupDir,key+'-'+path.basename(FILES[key])+'.bak');
    fs.copyFileSync(FILES[key],dst,fs.constants.COPYFILE_EXCL);
    fs.chmodSync(dst,0o600);
  }

  const changed=[];
  let helperCreated=false;

  try{
    fs.writeFileSync(FILES.helper,HELPER_CONTENT,{flag:'wx',mode:0o700});
    helperCreated=true;
    if(shaFile(FILES.helper)!==HELPER_SHA)fail('helper_sha_after_write_mismatch');

    for(const key of ['executor','plugin','policy','v4helper']){
      atomicReplace(FILES[key],candidate[key]);
      changed.push(key);
    }

    systemctl(['restart','prhm-company-approval.service']);
    systemctl(['restart','prhm-agent-selfmaint-exec.service']);
    systemctl(['restart','prhm-agent-mcp.service']);

    for(const unit of [
      'prhm-company-approval.service',
      'prhm-agent-selfmaint-exec.service',
      'prhm-agent-mcp.service'
    ]){
      if(!waitActive(unit))fail('service_not_active:'+unit);
    }

    const self=unixHealth('/run/prhm-agent-selfmaint-exec/exec.sock');
    if(self.ok!==true||self.version!=='1.5.0-host-actions-v2-leadops-economics-foundation')
      fail('selfmaint_health_invalid:'+JSON.stringify(self));

    const mcp=loopbackHealth(8123);
    if(mcp.ok!==true||mcp.version!=='0.16.0-policy-hardened')
      fail('mcp_health_invalid:'+JSON.stringify(mcp));

    if(shaFile(FILES.plugin)!==pluginSha)fail('plugin_post_sha_mismatch');
    if(!fs.readFileSync(FILES.plugin,'utf8').includes(ACTION))fail('action_missing_from_plugin');
    if(!fs.readFileSync(FILES.executor,'utf8').includes(ACTION))fail('action_missing_from_executor');

    const p=JSON.parse(fs.readFileSync(FILES.policy,'utf8'));
    if(p.operations?.['host_action.leadops_economics_inputs_foundation_v1']?.level!==4)
      fail('policy_operation_postverify_failed');
    if(!p.typed_scopes.some(x=>x&&x.action===ACTION&&x.operation==='host_action.leadops_economics_inputs_foundation_v1'))
      fail('policy_scope_postverify_failed');

    const result={
      ok:true,
      schema_version:'prhm.host-action-install-result.v1',
      installed:true,
      version:'1.5.0-host-actions-v2-leadops-economics-foundation',
      action:ACTION,
      helper_sha256:HELPER_SHA,
      mcp_plugin_sha256:pluginSha,
      approval_policy_version:p.version,
      host_action_v4_preserved:true,
      mcp_candidate_schema_compare_v1_preserved:true,
      economics_foundation_executed:false,
      migration_009_executed:false,
      database_mutation:false,
      business_mutation:false,
      p0_live:false,
      proposal_send:false,
      bid_send:false,
      backup_dir:backupDir
    };
    console.log(JSON.stringify(result));
  }catch(error){
    const rollbackErrors=[];

    for(const key of [...changed].reverse()){
      try{
        const backup=path.join(backupDir,key+'-'+path.basename(FILES[key])+'.bak');
        atomicReplace(FILES[key],fs.readFileSync(backup,'utf8'));
      }catch(e){rollbackErrors.push(key+':'+e.message)}
    }

    if(helperCreated){
      try{fs.unlinkSync(FILES.helper)}catch(e){rollbackErrors.push('helper:'+e.message)}
    }

    for(const unit of [
      'prhm-company-approval.service',
      'prhm-agent-selfmaint-exec.service',
      'prhm-agent-mcp.service'
    ]){
      try{systemctl(['restart',unit])}catch(e){rollbackErrors.push(unit+':'+e.message)}
    }

    if(rollbackErrors.length)
      fail('v5_install_failed_and_rollback_incomplete:'+error.message+':'+rollbackErrors.join('|'));

    fail('v5_install_failed_rolled_back:'+error.message);
  }
}
main();
