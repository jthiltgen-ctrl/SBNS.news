const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return jsonResponse({
        ok: true,
        name: "Shocked But Not Surprised",
        acronym: "SBNS",
        version: "prototype v1",
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
