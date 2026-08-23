export function getRequestOrigin(request) {
  const configuredUrl = process.env.SITE_URL || process.env.PUBLIC_SITE_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");

  const forwardedHost = request.headers["x-forwarded-host"];
  const forwardedProto = request.headers["x-forwarded-proto"];
  const host = forwardedHost || request.headers.host;
  const proto = forwardedProto || "https";

  return `${proto}://${host}`;
}
