const views = [...document.querySelectorAll("main > section")];
const queue = document.querySelector("#queue");
const queueStatus = document.querySelector("#queue-status");
const detail = document.querySelector("#detail");
let current;

function element(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
function show(id) { views.forEach((view) => { view.hidden = view.id !== id; }); }
function key() { return crypto.randomUUID(); }
async function api(path, options = {}) {
  const headers = { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json", "Idempotency-Key": key() } : {}), ...options.headers };
  const response = await fetch(path, { ...options, headers }); const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || "Request failed."); return body;
}
function section(title) { const panel = element("section", null, "panel"); panel.append(element("h2", title)); return panel; }
function field(label, value) { const p = element("p"); p.append(element("strong", `${label}: `), document.createTextNode(value ?? "—")); return p; }

async function loadQueue() {
  show("queue-view"); queue.replaceChildren(); queueStatus.textContent = "Loading queue…";
  const status = document.querySelector("#status-filter").value; const origin = document.querySelector("#origin-filter").value; const params = new URLSearchParams(); if (status) params.set("status", status); if (origin) params.set("origin", origin); const data = await api(`/api/admin/intakes${params.size ? `?${params}` : ""}`);
  queueStatus.textContent = data.intakes.length ? `${data.intakes.length} queue item${data.intakes.length === 1 ? "" : "s"}.` : "Queue is empty.";
  data.intakes.forEach((item) => { const card = element("article", null, "card"); const open = element("button"); open.type = "button"; open.append(element("h3", item.submitted_url), field("Origin", item.origin), field("Workflow", item.status), field("Analysis", item.analysis_status), field("Recommendation", item.latest_recommendation), field("Category", item.latest_category), field("Severity", item.latest_severity), field("Latest revision", item.latest_draft_revision), field("Latest decision", item.latest_decision), field("Last activity", item.updated_at)); open.addEventListener("click", () => loadDetail(item.id)); card.append(open); queue.append(card); });
}

function draftForm(intakeId, latest) {
  const panel = section(latest ? "Save as new revision" : "Create draft revision"); const form = element("form");
  const fields = [["story_id","Story ID","input"],["headline","Headline","input"],["summary","Summary","textarea"],["fml_kicker","FML kicker","textarea"],["topic_tags","Tags, comma-separated","input"]];
  fields.forEach(([name,labelText,tag]) => { const label=element("label",labelText); const input=element(tag); input.name=name; input.value=name === "topic_tags" ? (latest?.topic_tags || []).join(", ") : latest?.[name] || ""; if (["headline","summary","fml_kicker"].includes(name)) input.required=true; label.append(input); form.append(label); });
  const categoryLabel=element("label","Category"); const category=element("select"); category.name="category"; ["International","National","Local"].forEach((value)=>{const option=element("option",value);option.value=value;option.selected=latest?.category===value;category.append(option)}); categoryLabel.append(category); form.append(categoryLabel);
  const severityLabel=element("label","Severity"); const severity=element("select"); severity.name="severity"; [1,2,3,4,5].forEach((value)=>{const option=element("option",String(value));option.value=String(value);option.selected=latest?.severity===value;severity.append(option)}); severityLabel.append(severity); form.append(severityLabel);
  const button=element("button",latest ? "Save as new revision" : "Save revision 1"); form.append(button); const status=element("p"); status.setAttribute("role","status");
  form.addEventListener("submit",async(event)=>{event.preventDefault(); const values=Object.fromEntries(new FormData(form)); values.severity=Number(values.severity); values.topic_tags=values.topic_tags.split(",").map((tag)=>tag.trim()).filter(Boolean); try{const saved=await api(`/api/admin/intakes/${intakeId}/drafts`,{method:"POST",body:JSON.stringify(values)}); status.textContent=`REVISION ${saved.draft.revision} SAVED`; await loadDetail(intakeId);}catch(error){status.textContent=error.message}}); panel.append(form,status); return panel;
}

async function decide(intakeId, decision, draftId) { await api(`/api/admin/intakes/${intakeId}/decisions`, { method:"POST", body:JSON.stringify({ decision, draft_id: decision === "approve" ? draftId : null, notes:null }) }); await loadDetail(intakeId); }
async function loadDetail(id, notice = "") {
  const data=await api(`/api/admin/intakes/${id}`); current=data; show("detail-view"); detail.replaceChildren();
  if(notice) detail.append(element("p",notice,"status"));
  const submission=section("SUBMISSION"); submission.append(field("URL",data.intake.submitted_url),field("Origin",data.intake.origin),field("Submitted",data.intake.submitted_at),field("Workflow",data.intake.status),field("Note",data.intake.submitter_note)); detail.append(submission);
  const analysis=section("ANALYSIS"); analysis.classList.add("analysis"); analysis.append(element("p",data.analyses.length ? `${data.analyses.length} validated analysis record(s).` : "LIVE ANALYZER NOT CONNECTED",data.analyses.length ? "" : "warning")); detail.append(analysis);
  const drafts=section("EDITORIAL DRAFTS"); data.drafts.forEach((draft)=>{draft.topic_tags=JSON.parse(draft.topic_tags_json); const card=element("article",null,"card draft"); card.append(element("h3",`REVISION ${draft.revision}`),field("Headline",draft.headline),field("Summary",draft.summary),element("p",draft.fml_kicker,"kicker"),field("Category",draft.category),field("Severity",draft.severity)); drafts.append(card)}); detail.append(drafts,draftForm(id,data.drafts.at(-1)));
  const decisions=section("HUMAN DECISIONS"); const latestDraft=data.drafts.at(-1); const approved=data.decisions.filter((item)=>item.decision==="approve").at(-1); if(approved&&latestDraft&&approved.draft_id!==latestDraft.id) decisions.append(element("p","Latest draft differs from approved revision. New approval required.","warning")); data.decisions.forEach((item)=>{const revision=data.drafts.find((draft)=>draft.id===item.draft_id)?.revision; decisions.append(field(item.decision==="approve"&&revision ? `APPROVED — REVISION ${revision}` : item.decision.toUpperCase(),item.decided_at))}); const row=element("div",null,"decision-row"); ["approve","hold","reject"].forEach((value)=>{const button=element("button",value==="approve"&&latestDraft ? `Approve revision ${latestDraft.revision}` : value); button.disabled=value==="approve"&&!latestDraft; button.addEventListener("click",()=>decide(id,value,latestDraft?.id)); row.append(button)}); decisions.append(row); detail.append(decisions);
  const audit=section("AUDIT HISTORY"); data.audit.forEach((item)=>audit.append(element("p",`${item.created_at} · ${item.actor_id || item.actor_type} · ${item.action}`,"audit"))); detail.append(audit);
}

document.querySelector("#new-intake").addEventListener("click",()=>show("new-view")); document.querySelectorAll(".back").forEach((button)=>button.addEventListener("click",loadQueue)); document.querySelector("#status-filter").addEventListener("change",loadQueue); document.querySelector("#origin-filter").addEventListener("change",loadQueue);
document.querySelector("#new-form").addEventListener("submit",async(event)=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));try{const data=await api("/api/admin/intakes",{method:"POST",body:JSON.stringify(values)});await loadDetail(data.intake.id,"Saved to queue. Live analysis is not connected yet.")}catch(error){document.querySelector("#new-status").textContent=error.message}});

try { const session=await api("/api/admin/session"); document.querySelector("#actor").textContent=session.actor.email; await loadQueue(); } catch(error) { document.querySelector("#actor").textContent="Authentication required"; queueStatus.textContent=error.message; }
