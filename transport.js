// Keep the page and its session token on a stable origin; only API traffic uses the tunnel.
const repo = document.querySelector('meta[name="study-route-repo"]')?.content;
let origin = repo ? null : location.origin;
let resolving = null;
let failed = false;
const notice = document.createElement('div');
notice.setAttribute('role', 'status');
notice.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#fff3cc;color:#382e16;padding:12px;text-align:center;font:16px system-ui';
notice.hidden = true;
document.body.append(notice);

function connection(ok) {
  const wasFailed = failed;
  failed = !ok; notice.hidden = ok;
  notice.textContent = 'Reconnecting to the study. Please keep this tab open; your saved progress is retained.';
  if (ok && wasFailed) window.dispatchEvent(new Event('study-reconnected'));
}

async function resolveOrigin() {
  if (!repo) return location.origin;
  if (resolving) return resolving;
  resolving = (async () => {
    let route;
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/contents/route.json?ref=live&t=${Date.now()}`,
        {cache:'no-store', referrerPolicy:'no-referrer', signal:AbortSignal.timeout(10000)});
      if (!res.ok) throw new Error('Route unavailable');
      route = JSON.parse(atob((await res.json()).content));
    } catch {
      const res = await fetch(`https://raw.githubusercontent.com/${repo}/live/route.json?t=${Date.now()}`,
        {cache:'no-store', referrerPolicy:'no-referrer', signal:AbortSignal.timeout(10000)});
      if (!res.ok) throw new Error('Route unavailable');
      route = await res.json();
    }
    const url = new URL(route.url);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.lhr\.life$/.test(url.hostname)
        || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Invalid study destination');
    }
    origin = url.origin;
    return origin;
  })();
  try { return await resolving; } finally { resolving = null; }
}

export async function apiFetch(path, options = {}) {
  const method = options.method || 'GET';
  // Reads may be repeated after rotation; actions must never be automatically replayed.
  const attempts = method === 'GET' && repo ? 2 : 1;
  for (let n = 0; n < attempts; n++) {
    try {
      if (!origin || n) await resolveOrigin();
      const res = await fetch(origin + path, {...options, cache:'no-store', referrerPolicy:'no-referrer',
        signal:AbortSignal.timeout(method === 'GET' ? 15000 : 240000)});
      if (res.status >= 500 || !/application\/json|text\/event-stream/.test(res.headers.get('Content-Type') || '')) {
        throw new Error('Study connection unavailable');
      }
      connection(true);
      return res;
    } catch (error) {
      connection(false);
      if (n === attempts - 1) throw error;
    }
  }
}

if (repo) setInterval(() => apiFetch('/api/info').catch(() => {}), 15000);
