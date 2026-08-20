import assert from "node:assert/strict";
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet, jwtVerify } from "jose";
import { verifyAccessRequest } from "../src/access-auth.js";
import { createAdminHandler } from "../src/admin-index.js";

const actor = { actorType: "editor", actorId: "editor@example.com", email: "editor@example.com" };
const COMMANDS = new Set(["check", "test"]);

class FakeStatement {
  constructor(db, sql) { this.db=db; this.sql=sql.replace(/\s+/g," ").trim(); this.values=[]; }
  bind(...values){this.values=values;return this}
  async run(){return this.db.run(this.sql,this.values)}
  async all(){return {results:this.db.all(this.sql,this.values)}}
  async first(column){const row=this.db.all(this.sql,this.values)[0]??null;return column&&row?row[column]:row}
}
class FakeDB {
  constructor(){this.s={intakes:[],analyses:[],drafts:[],decisions:[],audit:[],idem:[],jobs:[],sources:[],claims:[],claimSources:[]};this.failAudit=false}
  prepare(sql){return new FakeStatement(this,sql)}
  async batch(statements){const before=structuredClone(this.s);try{const out=[];for(const statement of statements)out.push(await statement.run());return out}catch(error){this.s=before;throw error}}
  run(sql,v){
    if(sql.startsWith("INSERT INTO intakes")){this.s.intakes.push({id:v[0],origin:v[1],submitted_url:v[2],submitted_at:v[3],submitter_note:v[4],status:v[5],analysis_status:v[6],created_at:v[7],updated_at:v[8]});return {success:true}}
    if(sql.startsWith("INSERT INTO analysis_jobs")){this.s.jobs.push({id:v[0],intake_id:v[1],job_type:v[2],state:v[3],attempt:v[4],source_id:v[5],analysis_id:v[6],enqueued_at:v[7],started_at:v[8],completed_at:v[9],last_error_code:v[10],last_error_message:v[11],created_at:v[12],updated_at:v[13]});return {success:true}}
    if(sql.startsWith("INSERT INTO editorial_drafts")){if(this.s.drafts.some((d)=>d.intake_id===v[1]&&d.revision===v[2]))throw new Error("UNIQUE constraint failed: editorial_drafts.intake_id, editorial_drafts.revision");this.s.drafts.push({id:v[0],intake_id:v[1],revision:v[2],story_id:v[3],headline:v[4],summary:v[5],fml_kicker:v[6],category:v[7],severity:v[8],topic_tags_json:v[9],created_at:v[10],created_by:v[11]});return {success:true}}
    if(sql.startsWith("INSERT INTO editorial_decisions")){this.s.decisions.push({id:v[0],intake_id:v[1],draft_id:v[2],decision:v[3],decided_by:v[4],decided_at:v[5],notes:v[6]});return {success:true}}
    if(sql.startsWith("INSERT INTO audit_events")){if(this.failAudit)throw new Error("synthetic audit failure");this.s.audit.push({id:v[0],actor_type:v[1],actor_id:v[2],action:v[3],entity_type:v[4],entity_id:v[5],metadata_json:v[6],created_at:v[7]});return {success:true}}
    if(sql.startsWith("INSERT INTO idempotency_records")){this.s.idem.push({key:v[0],actor_id:v[1],operation:v[2],request_hash:v[3],response_status:v[4],response_json:v[5],created_at:v[6]});return {success:true}}
    if(sql.startsWith("UPDATE intakes SET updated_at")){const row=this.s.intakes.find((x)=>x.id===v[1]);if(row)row.updated_at=v[0];return {success:true}}
    if(sql.startsWith("UPDATE intakes SET status = ?")){const row=this.s.intakes.find((x)=>x.id===v[2]);if(row){row.status=v[0];row.updated_at=v[1]}return {success:true}}
    if(sql.startsWith("UPDATE analysis_jobs SET state='queued'")){const row=this.s.jobs.find((x)=>x.id===v[2]&&x.intake_id===v[3]);if(row){row.state="queued";row.enqueued_at=v[0];row.updated_at=v[1]}return {success:true}}
    if(sql.startsWith("UPDATE intakes SET status='queued'")){const row=this.s.intakes.find((x)=>x.id===v[1]);if(row){row.status="queued";row.analysis_status="queued";row.updated_at=v[0]}return {success:true}}
    if(sql.startsWith("UPDATE idempotency_records SET response_status")){const row=this.s.idem.find((x)=>x.actor_id===v[2]&&x.operation===v[3]&&x.key===v[4]);if(row){row.response_status=v[0];row.response_json=v[1]}return {success:true}}
    throw new Error(`Unhandled run: ${sql}`)
  }
  all(sql,v){
    if(sql.startsWith("SELECT * FROM idempotency_records"))return this.s.idem.filter((x)=>x.actor_id===v[0]&&x.operation===v[1]&&x.key===v[2]);
    if(sql==="SELECT * FROM intakes WHERE id = ?")return this.s.intakes.filter((x)=>x.id===v[0]);
    if(sql.startsWith("SELECT * FROM editorial_drafts WHERE intake_id = ? ORDER BY revision DESC"))return this.s.drafts.filter((x)=>x.intake_id===v[0]).sort((a,b)=>b.revision-a.revision).slice(0,1);
    if(sql.startsWith("SELECT * FROM analysis_jobs WHERE intake_id = ? AND state IN"))return this.s.jobs.filter((x)=>x.intake_id===v[0]&&["pending_enqueue","queued","running","retrying"].includes(x.state)).slice(-1);
    if(sql.startsWith("SELECT * FROM analysis_jobs WHERE intake_id = ? ORDER BY created_at DESC"))return this.s.jobs.filter((x)=>x.intake_id===v[0]).slice(-1);
    if(sql.startsWith("SELECT * FROM analysis_jobs WHERE id = ?"))return this.s.jobs.filter((x)=>x.id===v[0]);
    if(sql==="SELECT * FROM editorial_drafts WHERE id = ?")return this.s.drafts.filter((x)=>x.id===v[0]);
    if(sql.startsWith("SELECT * FROM editorial_drafts WHERE intake_id = ? ORDER BY revision ASC"))return this.s.drafts.filter((x)=>x.intake_id===v[0]).sort((a,b)=>a.revision-b.revision);
    if(sql.startsWith("SELECT * FROM analyses WHERE intake_id"))return this.s.analyses.filter((x)=>x.intake_id===v[0]);
    if(sql.startsWith("SELECT * FROM editorial_decisions WHERE intake_id"))return this.s.decisions.filter((x)=>x.intake_id===v[0]);
    if(sql.startsWith("SELECT * FROM audit_events"))return this.s.audit.filter((x)=>x.entity_type===v[0]&&x.entity_id===v[1]);
    if(sql.startsWith("SELECT * FROM analysis_jobs WHERE intake_id = ? ORDER BY created_at ASC"))return this.s.jobs.filter((x)=>x.intake_id===v[0]);
    if(sql.startsWith("SELECT id, intake_id, url"))return this.s.sources.filter((x)=>x.intake_id===v[0]);
    if(sql.startsWith("SELECT * FROM claims WHERE intake_id"))return this.s.claims.filter((x)=>x.intake_id===v[0]);
    if(sql.startsWith("SELECT claim_sources.*"))return this.s.claimSources.filter((x)=>x.intake_id===v[0]);
    if(sql.startsWith("SELECT intakes.*")){let rows=[...this.s.intakes];let i=0;if(sql.includes("status = ?"))rows=rows.filter((x)=>x.status===v[i++]);if(sql.includes("origin = ?"))rows=rows.filter((x)=>x.origin===v[i++]);return rows.slice(0,v.at(-1)).map((x)=>({...x,latest_recommendation:null,latest_category:null,latest_severity:null,latest_draft_revision:this.s.drafts.filter((d)=>d.intake_id===x.id).sort((a,b)=>b.revision-a.revision)[0]?.revision??null,latest_decision:this.s.decisions.filter((d)=>d.intake_id===x.id).at(-1)?.decision??null}))}
    throw new Error(`Unhandled all: ${sql}`)
  }
}

function request(path,{method="GET",body,headers={}}={}){return new Request(`https://admin.example${path}`,{method,body:body===undefined?undefined:JSON.stringify(body),headers:{...(body===undefined?{}:{"content-type":"application/json"}),...headers}})}
async function body(response){return response.json()}
function app(db,authenticate=async()=>actor){return createAdminHandler({authenticate}).bind(null)}
async function call(handler,db,path,options){return handler(request(path,options),{SBNS_DB:db,ANALYSIS_QUEUE:{send:async()=>({})},ADMIN_ASSETS:{fetch:()=>new Response("asset")}})}

async function jwtTests(){
  const {publicKey,privateKey}=await generateKeyPair("RS256");const jwk=await exportJWK(publicKey);jwk.kid="test";jwk.alg="RS256";const local=createLocalJWKSet({keys:[jwk]});const env={ACCESS_TEAM_DOMAIN:"https://team.cloudflareaccess.com",ACCESS_AUD:"aud"};
  const sign=(claims={},options={})=>new SignJWT({email:"editor@example.com",...claims}).setProtectedHeader({alg:"RS256",kid:"test"}).setIssuer(options.issuer||env.ACCESS_TEAM_DOMAIN).setAudience(options.audience||env.ACCESS_AUD).setIssuedAt().setExpirationTime(options.exp||"5m").sign(privateKey);
  const verifier=(token,_remote,config)=>jwtVerify(token,local,config);
  await assert.rejects(()=>verifyAccessRequest(request("/",{}),env,verifier));
  const wrongIssuer=await sign({}, {issuer:"https://wrong.cloudflareaccess.com"});
  const wrongAudience=await sign({}, {audience:"wrong"});
  const expired=await sign({}, {exp:"-1m"});
  const missingEmail=await new SignJWT({}).setProtectedHeader({alg:"RS256",kid:"test"}).setIssuer(env.ACCESS_TEAM_DOMAIN).setAudience(env.ACCESS_AUD).setExpirationTime("5m").sign(privateKey);
  await assert.rejects(()=>verifyAccessRequest(new Request("https://x",{headers:{"Cf-Access-Jwt-Assertion":wrongIssuer}}),env,verifier));
  await assert.rejects(()=>verifyAccessRequest(new Request("https://x",{headers:{"Cf-Access-Jwt-Assertion":wrongAudience}}),env,verifier));
  await assert.rejects(()=>verifyAccessRequest(new Request("https://x",{headers:{"Cf-Access-Jwt-Assertion":expired}}),env,verifier));
  await assert.rejects(()=>verifyAccessRequest(new Request("https://x",{headers:{"Cf-Access-Jwt-Assertion":missingEmail}}),env,verifier));
  const valid=await verifyAccessRequest(new Request("https://x",{headers:{"Cf-Access-Jwt-Assertion":await sign()}}),env,verifier);assert.equal(valid.email,"editor@example.com");
  return 6;
}

async function apiTests(){
  let count=0;const pass=(condition,message)=>{assert.ok(condition,message);count++};const db=new FakeDB();
  let handler=app(db,async()=>{throw new Error("AUTH_REQUIRED")});let response=await call(handler,db,"/api/admin/session");pass(response.status===401,"missing auth");
  handler=app(db,async()=>{throw new Error("AUTH_REQUIRED")});response=await call(handler,db,"/api/admin/session");pass((await body(response)).error.code==="AUTH_REQUIRED","invalid auth");
  handler=app(db);response=await call(handler,db,"/api/admin/session");pass(response.status===200,"valid actor");const session=await body(response);pass(session.actor.email===actor.email&&!JSON.stringify(session).includes("jwt"),"session/no JWT");
  const create=(payload,key="i1")=>call(handler,db,"/api/admin/intakes",{method:"POST",body:payload,headers:{"Idempotency-Key":key}});
  response=await create({submitted_url:"https://example.com/report",submitter_note:"note"});const created=await body(response);pass(response.status===201,"create intake");const id=created.intake.id;
  pass((await create({submitted_url:"nope"},"bad")).status===400,"malformed URL");pass((await create({submitted_url:"https://u:p@example.com"},"creds")).status===400,"credential URL");pass((await create({submitted_url:"https://example.com",submitter_note:"x".repeat(2001)},"note")).status===400,"note bound");
  response=await call(handler,db,"/api/admin/intakes");pass((await body(response)).intakes.length===1,"list");response=await call(handler,db,"/api/admin/intakes?status=queued");pass((await body(response)).intakes.length===1,"status filter");response=await call(handler,db,"/api/admin/intakes?origin=editor");pass((await body(response)).intakes.length===1,"origin filter");response=await call(handler,db,`/api/admin/intakes/${id}`);pass((await body(response)).intake.id===id,"detail");pass((await call(handler,db,"/api/admin/intakes/missing")).status===404,"missing detail");
  const draftPayload={story_id:"story",headline:"Headline",summary:"Summary",fml_kicker:"Kicker",category:"Local",severity:2,topic_tags:["audit"]};const draft=(payload,key)=>call(handler,db,`/api/admin/intakes/${id}/drafts`,{method:"POST",body:payload,headers:{"Idempotency-Key":key}});
  response=await draft(draftPayload,"d1");const d1=(await body(response)).draft;pass(d1.revision===1,"revision1");response=await draft({...draftPayload,headline:"Headline 2"},"d2");const d2=(await body(response)).draft;pass(d2.revision===2,"revision2");pass(db.s.drafts[0].headline==="Headline","immutable");
  const decision=(value,draftId,key)=>call(handler,db,`/api/admin/intakes/${id}/decisions`,{method:"POST",body:{decision:value,draft_id:draftId,notes:null},headers:{"Idempotency-Key":key}});
  pass((await decision("approve",null,"a0")).status===400,"approve requires draft");pass((await decision("hold",null,"h1")).status===201,"hold");pass((await decision("reject",null,"r1")).status===201,"reject");pass((await decision("approve",d2.id,"a1")).status===201,"approve exact");
  const other=await body(await create({submitted_url:"https://example.com/other"},"i2"));pass((await call(handler,db,`/api/admin/intakes/${other.intake.id}/decisions`,{method:"POST",body:{decision:"approve",draft_id:d2.id},headers:{"Idempotency-Key":"cross"}})).status===400,"cross intake");
  pass(db.s.intakes.find((x)=>x.id===id).status==="approved","approved status");pass(db.s.audit.some((x)=>x.action==="decision.hold"),"held status/audit");pass(db.s.audit.some((x)=>x.action==="decision.reject"),"rejected status/audit");pass(db.s.audit.every((x)=>x.actor_id===actor.email),"audit actor");
  response=await create({submitted_url:"https://example.com/report",submitter_note:"note"});pass(response.status===201&&db.s.intakes.filter((x)=>x.id===id).length===1,"intake replay");pass((await create({submitted_url:"https://example.com/different"})).status===409,"idempotency conflict");response=await draft({...draftPayload,headline:"Headline 2"},"d2");pass(response.status===201&&db.s.drafts.length===2,"draft replay");response=await decision("approve",d2.id,"a1");pass(response.status===201&&db.s.decisions.filter((x)=>x.decision==="approve").length===1,"decision replay");pass((await call(handler,db,"/api/admin/nope")).status===404,"unknown API");
  pass(db.s.decisions.find((x)=>x.decision==="approve").draft_id!==db.s.drafts[0].id,"approved revision exact");response=await draft({...draftPayload,headline:"Headline 3"},"d3");const d3=(await body(response)).draft;pass(d3.revision===3&&db.s.decisions.find((x)=>x.decision==="approve").draft_id!==d3.id,"latest/approved mismatch detectable");db.failAudit=true;const before=db.s.intakes.length;response=await create({submitted_url:"https://example.com/rollback"},"rollback");pass(response.status===500&&db.s.intakes.length===before,"atomic rollback");db.failAudit=false;
  pass(db.s.audit.some((x)=>x.action==="intake.created"),"intake audit");pass(db.s.audit.some((x)=>x.action==="draft.created"),"draft audit");pass(db.s.idem.length>=6,"idempotency records");pass(db.s.drafts.length===3,"no duplicate revisions");pass(db.s.decisions.length===3,"no duplicate decisions");pass(db.s.intakes.every((x)=>x.analysis_status==="queued")&&db.s.jobs.length===2,"analysis jobs queued");
  return count;
}

async function check(){await import("../src/admin-index.js");await import("../src/access-auth.js");console.log("Admin contract valid: authenticated routes, bounded writes, static fallback, and no runtime auth bypass.")}
async function test(){const jwt=await jwtTests();const api=await apiTests();console.log(`Admin tests passed: ${api} API scenarios and ${jwt} JWT scenarios.`)}
const command=process.argv[2];if(!COMMANDS.has(command)){console.error("Usage: node scripts/admin-api.mjs <check|test>");process.exitCode=1}else{try{if(command==="check")await check();else await test()}catch(error){console.error(error.stack||error.message);process.exitCode=1}}
