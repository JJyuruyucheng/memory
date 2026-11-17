// Deploy this no-import replacement after every success OR failure and confirm
// that the former capability now receives 410. No environment keys are read.
export default {
  fetch() { return new Response('{"error":"VERIFICATION_CLOSED"}', { status: 410, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); },
};
