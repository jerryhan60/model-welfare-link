const status = document.getElementById('status');
const retry = document.getElementById('retry');

async function currentRoute() {
  const options = {cache: 'no-store', referrerPolicy: 'no-referrer'};
  try {
    // The public API sees a new commit sooner than the raw-file CDN. No token is used.
    const response = await fetch('https://api.github.com/repos/jerryhan60/model-welfare-link/contents/route.json?ref=live&t=' + Date.now(),
      {...options, signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error('API unavailable');
    return JSON.parse(atob((await response.json()).content));
  } catch {
    // Keep working if GitHub's anonymous API allowance is exhausted.
    const response = await fetch('https://raw.githubusercontent.com/jerryhan60/model-welfare-link/live/route.json?t=' + Date.now(),
      {...options, signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error('Route unavailable');
    return response.json();
  }
}

async function connect() {
  retry.hidden = true;
  status.textContent = 'Connecting you to the study. This should only take a moment.';
  try {
    // Read the live branch directly: tunnel changes do not need a Pages rebuild.
    const route = await currentRoute();
    const target = new URL(route.url);
    if (target.protocol !== 'https:' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.lhr\.life$/.test(target.hostname)
        || target.port || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
      throw new Error('Invalid destination');
    }
    // Forward only the invitation. Never copy researcher credentials or arbitrary redirects.
    const invite = new URLSearchParams(location.search).get('invite');
    if (!invite) {
      document.querySelector('h1').textContent = 'Study invitation required';
      status.textContent = 'Please use the full invitation link provided by the researcher.';
      return;
    }
    target.searchParams.set('invite', invite);
    location.replace(target.href);
  } catch {
    status.textContent = 'The study connection is temporarily unavailable. Please try again in a minute.';
    retry.hidden = false;
  }
}
retry.addEventListener('click', connect);
connect();
