import { createRemoteJWKSet, jwtVerify } from "jose";

const HEADER = "Cf-Access-Jwt-Assertion";

function configuration(env) {
  if (!env?.ACCESS_TEAM_DOMAIN || !env?.ACCESS_AUD) throw new Error("Access configuration unavailable");
  const issuer = new URL(env.ACCESS_TEAM_DOMAIN).origin;
  if (!issuer.endsWith(".cloudflareaccess.com")) throw new Error("Access configuration unavailable");
  return { issuer, audience: env.ACCESS_AUD };
}

export async function verifyAccessRequest(request, env, verifier = jwtVerify) {
  const token = request.headers.get(HEADER);
  if (!token) throw new Error("AUTH_REQUIRED");
  const { issuer, audience } = configuration(env);
  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  let payload;
  try {
    ({ payload } = await verifier(token, jwks, { issuer, audience }));
  } catch {
    throw new Error("AUTH_REQUIRED");
  }
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email) throw new Error("AUTH_REQUIRED");
  return { actorType: "editor", actorId: email, email };
}
