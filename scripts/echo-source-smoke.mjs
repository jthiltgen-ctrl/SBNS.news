// Explicit development-only live check. Never imported by npm run check or CI.
// No persistence, candidate assembly, or Echo orchestration is invoked here.
import { discoverLoc, discoverSmithsonian, verifyDiscoveredContext } from "../src/echo-source-adapters.js";

const query = { terms: ["labor song"] };
const selected = process.argv[2] ?? "both";
if (!["both", "loc", "smithsonian"].includes(selected)) throw new Error("Use both, loc, or smithsonian");
let requests = 0;
const results = [];
async function one(label, discover, options = {}) {
  try {
    requests += 1;
    const records = await discover(query, options);
    const first = records[0] ?? null;
    let context = "no result";
    if (first) {
      requests += 1;
      const verified = await verifyDiscoveredContext(first, options);
      context = verified.context.status;
    }
    results.push({ adapter: label, searchResults: records.length, detailContext: context, status: "ok" });
  } catch (error) {
    results.push({ adapter: label, status: "failed", code: error?.code ?? "UNEXPECTED_ERROR" });
  }
}
if (selected !== "smithsonian") await one("loc", discoverLoc);
const smithsonianApiKey = process.env.SMITHSONIAN_API_KEY;
if (selected !== "loc") {
  if (smithsonianApiKey) await one("smithsonian", discoverSmithsonian, { apiKey: smithsonianApiKey });
  else results.push({ adapter: "smithsonian", status: "skipped", code: "DEVELOPMENT_API_KEY_NOT_SET" });
}

// Deliberately report counts/status only, never source content or an API key.
process.stdout.write(`${JSON.stringify({ mode: "development-only", requests, persisted: false, results })}\n`);
if (results.some((item) => item.status === "failed")) process.exitCode = 1;
