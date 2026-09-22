import { createRemoteJWKSet, jwtVerify } from "jose";

const HEADER = "Cf-Access-Jwt-Assertion";

function configuration(env) {
  if (!env?.ACCESS_TEAM_DOMAIN || !env?.ACCESS_AUD) throw new Error("Access configuration unavailable");
  const issuer = new URL(env.ACCESS_TEAM_DOMAIN).origin;
  if (!issuer.endsWith(".cloudflareaccess.com")) throw new Error("Access configuration unavailable");
  return { issuer, audience: env.ACCESS_AUD };
}

async function verifiedAccessPayload(request, env, verifier) {
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
  return payload;
}

export async function verifyAccessRequest(request, env, verifier = jwtVerify) {
  const payload = await verifiedAccessPayload(request, env, verifier);
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email) throw new Error("AUTH_REQUIRED");
  return { actorType: "editor", actorId: email, email };
}

export async function verifyAccessServiceRequest(request, env, verifier = jwtVerify) {
  const payload = await verifiedAccessPayload(request, env, verifier);
  // Access issues this signed claim shape for service tokens. The application
  // policy restricts which service token may obtain a JWT for this audience.
  if (payload.type !== "app" || payload.sub !== "" ||
      typeof payload.common_name !== "string" || !/^[a-zA-Z0-9]+\.access$/.test(payload.common_name) ||
      payload.email != null) throw new Error("AUTH_REQUIRED");
}
