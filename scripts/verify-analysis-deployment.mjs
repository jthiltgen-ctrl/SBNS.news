import { readFile } from "node:fs/promises";

const WORKER = "sbns-analysis";
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;

async function api(path) {
  if (!account || !token) throw new Error("Cloudflare CI credentials are required");
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}${path}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true) throw new Error(`Cloudflare readback failed: HTTP ${response.status}`);
  return body.result;
}

function deploymentId(result) {
  const rows = Array.isArray(result) ? result : result?.deployments;
  if (!Array.isArray(rows) || !rows.length) throw new Error("No analysis deployment found");
  return [...rows].sort((a, b) => String(b.created_on).localeCompare(String(a.created_on)))[0];
}

export function verifyVersion({ beforeId, deployment, version, expectedSha }) {
  if (!/^[0-9a-f]{40}$/.test(expectedSha)) throw new Error("Expected revision is invalid");
  if (!deployment?.id || deployment.id === beforeId) throw new Error("No new analysis deployment was produced");
  if (deployment.versions?.length !== 1 || deployment.versions[0].percentage !== 100) throw new Error("Expected analysis version is not at 100% traffic");
  if (version?.id !== deployment.versions[0].version_id) throw new Error("Analysis version readback does not match deployment");
  const bindings = version.resources?.bindings;
  const list = Array.isArray(bindings) ? bindings : Object.entries(bindings || {}).map(([name, binding]) => ({ ...binding, name: binding?.name ?? name }));
  if (!list.some((binding) => binding?.name === "SBNS_ANALYSIS_BUILD_SHA" && binding?.type === "plain_text" && binding?.text === expectedSha)) {
    throw new Error("Analysis version build SHA binding does not match merged revision");
  }
  return version.id;
}

export function verifyConsumer(result) {
  const rows = Array.isArray(result) ? result : result?.consumers;
  if (!Array.isArray(rows) || !rows.some((row) => row?.script === WORKER || row?.script_name === WORKER || row?.scriptName === WORKER || row?.settings?.script === WORKER)) {
    throw new Error("sbns-analysis queue consumer is not attached");
  }
}

async function main() {
  const command = process.argv[2];
  if (command === "consumer") {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    verifyConsumer(JSON.parse(input));
    console.log("Verified sbns-analysis queue consumer.");
    return;
  }
  const deployments = await api(`/workers/scripts/${WORKER}/deployments`);
  const latest = deploymentId(deployments);
  if (command === "snapshot") { console.log(latest.id); return; }
  if (command !== "verify" || !process.argv[3]) throw new Error("Expected snapshot or verify command");
  const beforeId = (await readFile(process.argv[3], "utf8")).trim();
  const versionId = latest.versions?.[0]?.version_id;
  if (!versionId) throw new Error("Analysis deployment has no version");
  const version = await api(`/workers/scripts/${WORKER}/versions/${encodeURIComponent(versionId)}`);
  const deployedId = verifyVersion({ beforeId, deployment: latest, version, expectedSha: process.env.GITHUB_SHA });
  console.log(`Verified ${WORKER} revision ${process.env.GITHUB_SHA} at 100% traffic (version ${deployedId}).`);
}

if (process.argv[1]?.endsWith("verify-analysis-deployment.mjs")) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
