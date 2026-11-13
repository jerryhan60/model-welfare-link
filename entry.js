const status = document.getElementById('status');
const retry = document.getElementById('retry');

async function connect() {
  retry.hidden = true;
  status.textContent = 'Connecting you to the study. This should only take a moment.';
  try {
    // Read the live branch directly: tunnel changes do not need a Pages rebuild.
    const response = await fetch('https://raw.githubusercontent.com/jerryhan60/model-welfare-link/live/route.json?t=' + Date.now(), {
      cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Route unavailable');
    const route = await response.json();
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
