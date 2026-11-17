export const CACHEABLE_VENDOR_PATHS = Object.freeze([
  '/assets/supabase-client-2.119.0.js', '/assets/air-datepicker-3.6.0.js',
  '/assets/air-datepicker-3.6.0.css', '/assets/sortable-1.15.7.js',
  '/assets/embla-carousel-8.6.0.js',
]);

export function cacheControlFor(pathname = '') {
  return CACHEABLE_VENDOR_PATHS.includes(pathname) ? 'public, max-age=31536000, immutable' : 'no-store';
}

export function securityHeaders(supabaseOrigin = '', pathname = '') {
  const connect = ["'self'", 'https://challenges.cloudflare.com', ...(supabaseOrigin ? [supabaseOrigin] : [])].join(' ');
  return {
    'Cache-Control': cacheControlFor(pathname),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src ${connect}; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
  };
}

export function cloudflareHeaders(supabaseOrigin = '') {
  const common = `/*\n${Object.entries(securityHeaders(supabaseOrigin)).map(([key, value]) => `  ${key}: ${value}`).join('\n')}\n`;
  // Pages combines matching headers. Explicitly detach the broader no-store rule
  // before enabling immutable caching for these exact pinned, public files.
  return common + CACHEABLE_VENDOR_PATHS.map(pathname => `\n${pathname}\n  ! Cache-Control\n  Cache-Control: ${cacheControlFor(pathname)}\n`).join('');
}
