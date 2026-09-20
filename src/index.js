import { REPORTING_STORY_IDS } from "./generated-story-ids.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

const STORY_IDS = new Set(REPORTING_STORY_IDS);
const STORY_PATH = /^\/story\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|\/index\.html|\.html)?$/;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function storyNotFound() {
  return new Response("Story not found.\n", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function storyResponse(request, env, url) {
  const match = url.pathname.match(STORY_PATH);
  if (!match || !STORY_IDS.has(match[1])) return storyNotFound();

  const canonicalPath = `/story/${match[1]}`;
  if (url.pathname !== canonicalPath) {
    const destination = new URL(url);
    destination.pathname = canonicalPath;
    return Response.redirect(destination, 308);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed\n", {
      status: 405,
      headers: {
        allow: "GET, HEAD",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/story" || url.pathname.startsWith("/story/")) {
      return storyResponse(request, env, url);
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return jsonResponse({
        ok: true,
        name: "Shocked But Not Surprised",
        acronym: "SBNS",
        version: "v1.5 production",
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return jsonResponse(
        {
          error: "Not Found",
          status: 404,
        },
        404,
      );
    }

    return env.ASSETS.fetch(request);
  },
};
