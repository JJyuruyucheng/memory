// Replace the temporary endpoint with this on success AND failure; verify HTTP 410
// using the old capability. No environment secrets or imports are needed here.
export default {
  fetch() {
    return new Response('{"error":"BOOTSTRAP_CLOSED"}', {
      status: 410,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  },
};
