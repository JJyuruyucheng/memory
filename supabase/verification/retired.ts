// Replace the temporary endpoint with this after success OR failure. Recheck 410
// using the old capability. This replacement needs no imports or environment keys.
export default {
  fetch() {
    return new Response('{"error":"VERIFICATION_CLOSED"}', {
      status: 410,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  },
};
