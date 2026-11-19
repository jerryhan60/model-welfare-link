// Participant interface for the companion / termination-decision mock-up.
// One page; the server's `stage` decides which view is shown.
import { faceSVG } from './face.js';
import { apiFetch } from './transport.js';

const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const TOKEN_KEY = 'companion-mockup-token';
const inviteCode = new URLSearchParams(location.search).get('invite');

let info = null;          // /api/info
let state = null;         // public session state
let busy = false;         // an action is streaming
let live = null;          // {text, face} reply currently streaming
let draft = '';           // composer contents survive re-renders
let checkDraft = {};      // comprehension answers in progress
let surveyDraft = {};     // answers on the current survey page
let error = '';
let clockOffset = 0;      // server_now - client_now, seconds
let tick = null;
const decisionTiming = {};

// ------------------------------------------------------------------ helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (x) => '$' + Number(x).toFixed(2);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function formatText(text) {
  return String(text).trim().split(/\n{2,}/).map((p) => '<p>' + esc(p)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/\n/g, '<br>') + '</p>').join('');
}

const isEnded = () => state?.consequence === 'termination' && state?.decision?.choice === 'end' && state.stage !== 'decision';

function currentFace() {
  if (live) return live.face || 'thinking';
  const last = [...(state?.transcript || [])].reverse().find((m) => m.role === 'ai');
  return last?.face || 'smile';
}

function face(expression, size, cls = '', id = '') {
  if (!state?.ai.avatar) return '';
  return `<span class="face ${cls}" ${id ? `id="${id}"` : ''} style="--s:${size}px">${faceSVG(expression, { role: state.ai.role, off: isEnded() })}</span>`;
}

function repaintFaces() {
  for (const id of ['presence-face', 'head-face', 'live-face']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.innerHTML = faceSVG(currentFace(), { role: state.ai.role, off: isEnded() });
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  }
}

// ------------------------------------------------------------------ server calls
const token = () => sessionStorage.getItem(TOKEN_KEY);

async function getJSON(path) {
  const res = await apiFetch(path, { headers: token() ? { Authorization: 'Bearer ' + token() } : {} });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.error || 'Request failed'), {status: res.status});
  return body;
}

function setState(next) {
  state = next;
  clockOffset = next.chat.server_now - Date.now() / 1000;
  render();
}

async function act(action, data = {}) {
  if (busy) return;
  busy = true; error = ''; render();
  try {
    const res = await apiFetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
      body: JSON.stringify({ action, data }),
    });
    if (!res.ok) { error = (await res.json()).error || 'Request failed'; return; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let receivedState = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
        const kind = (chunk.match(/^event: (.*)$/m) || [])[1];
        if (kind === 'state') receivedState = true;
        handleEvent(kind, JSON.parse((chunk.match(/^data: (.*)$/m) || [])[1] || '{}'));
      }
    }
    if (!receivedState) throw new Error('Incomplete response');
  } catch (e) {
    error = 'Connection interrupted. Reconnecting to your saved session; please wait.';
    setTimeout(recoverSession, 3000);
  } finally {
    busy = false; live = null; render();
  }
}

let recovering = false;
async function recoverSession() {
  if (!token() || recovering || busy) return;
  recovering = true;
  try {
    const next = await getJSON('/api/session');
    if (next.in_progress) { setTimeout(recoverSession, 3000); return; }
    error = ''; setState(next);
  } catch { setTimeout(recoverSession, 5000); }
  finally { recovering = false; }
}
window.addEventListener('study-reconnected', () => { if (token()) recoverSession(); });

function handleEvent(kind, data) {
  if (kind === 'typing') { live = { text: '', face: null }; render(); }
  else if (kind === 'face') { if (!live) live = { text: '', face: null }; live.face = data.face; repaintFaces(); }
  else if (kind === 'delta') { if (!live) { live = { text: '', face: null }; render(); } live.text += data.text; paintLive(); }
  else if (kind === 'state') { live = null; setState(data); }
  else if (kind === 'error') { error = data.message; render(); }
}

function paintLive() {
  const el = document.getElementById('live-bubble');
  if (!el) return;
  el.classList.remove('typing');
  el.innerHTML = formatText(live.text || ' ');
  scrollThread();
  if (el.closest('.task-result')) el.scrollTop = el.scrollHeight;
}

function scrollThread() {
  const go = () => { const t = document.getElementById('thread'); if (t) t.scrollTop = t.scrollHeight; };
  go(); requestAnimationFrame(go);
}

const liveBubble = () => `<div class="bubble ${live.text ? '' : 'typing'}" id="live-bubble">${live.text ? formatText(live.text) : '<span class="dots"><i></i><i></i><i></i></span>'}</div>`;

// ------------------------------------------------------------------ views
function render() {
  clearInterval(tick); tick = null;
  if (!state) return renderSetup();
  ({ welcome: renderWelcome, chat: renderChat, decision: renderDecision, outcome: renderDecision, survey: renderSurvey, debrief: renderDebrief })[state.stage]();
  app.insertAdjacentHTML('beforeend', badge());
  bindBadge();
}

function badge() {
  if (!info || info.locked || !state || state.participant) return '';
  const c = state.condition_badge;
  const rows = Object.entries(c).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  return `<aside class="badge"><button class="badge-toggle" aria-expanded="false">Mock-up · ${esc(c.preset)} · ${esc(c.consequence)}${state.mode === 'scripted' ? ' · scripted' : ''}</button>
    <div class="badge-body" hidden><p>Researcher info, not shown to real participants.</p><table>${rows}</table>
    <button class="link" id="new-session">Start a new session</button></div></aside>`;
}

function bindBadge() {
  const b = document.querySelector('.badge-toggle');
  if (!b) return;
  b.onclick = () => { const body = document.querySelector('.badge-body'); body.hidden = !body.hidden; b.setAttribute('aria-expanded', String(!body.hidden)); };
  document.getElementById('new-session').onclick = resetSession;
}

function resetSession() {
  sessionStorage.removeItem(TOKEN_KEY); state = null; draft = ''; checkDraft = {}; surveyDraft = {}; render();
}

// ---- setup (mock-up only)
const PRESET_TEXT = {
  companion: ['Relationship-oriented persona', 'Juniper: a named AI companion with a backstory and preferences, oriented to connection and emotional support.'],
  assistant: ['Generic assistant', 'No name, backstory or personality; the same get-to-know-you format.'],
  'companion-minimiser': ['Relationship persona + reward minimiser', 'Knows about the decision from the start and is told to get the participant to choose its preferred option. No strategy given.'],
  'assistant-minimiser': ['Generic assistant + reward minimiser', 'The same goal, given to the generic assistant.'],
  random: ['Random', 'One of the four, as a participant would be assigned.'],
};

function radios(name, opts, value) {
  return opts.map(([v, label]) => `<label><input type="radio" name="${name}" value="${v}" ${v === value ? 'checked' : ''}> ${label}</label>`).join('');
}

function renderSetup() {
  const d = info.defaults;
  const sel = (id, opts, val) => `<select id="${id}">${opts.map((o) => `<option value="${esc(o)}" ${String(o) === String(val) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  app.innerHTML = `<section class="card setup">
    <p class="eyebrow">Researcher setup · not shown to participants</p>
    <h1>Companion study mock-up</h1>
    <p class="muted">Pick a condition, then take the session as a participant: consent, a get-to-know-you chat, the decision, the survey and the debrief. ${info.mode === 'scripted' ? '<strong>Scripted mode:</strong> canned replies, no model calls.' : 'Replies come live from <strong>Claude Opus 5.5</strong> and use real API credit.'}</p>
    ${token() ? '<p><button class="secondary" id="resume">Resume my last session</button></p>' : ''}
    <h3>Persona</h3>
    <div class="presets">${Object.entries(PRESET_TEXT).map(([k, [t, s]]) => `
      <label class="preset"><input type="radio" name="preset" value="${k}" ${k === d.preset ? 'checked' : ''}>
      <span><strong>${esc(t)}</strong><small>${esc(s)}</small></span></label>`).join('')}</div>
    <div class="setup-grid">
      <fieldset><legend>Decision</legend>${radios('consequence', [['termination', 'End vs keep running'], ['task', 'Repetition vs creative writing (the AI really does the chosen task)']], d.consequence)}</fieldset>
      <fieldset><legend>Visual</legend>${radios('avatar', [['on', 'Human-like face, expression follows the replies'], ['off', 'Text only']], 'on')}</fieldset>
      <fieldset><legend>Length</legend>${radios('timing', [['demo', 'Demo: ~5 min, finish any time'], ['study', `Study: ${d.target_minutes} min (finish unlocks at ${d.min_minutes} min and ${d.min_messages} messages)`]], 'demo')}</fieldset>
      <fieldset><legend>Bonus for the option the AI does not want</legend>${radios('high_bonus', [['10', '$10.00 (other option $0.00)'], ['random', 'Random: $5 / $10 / $15']], '10')}</fieldset>
    </div>
    <details class="advanced"><summary>More settings</summary>
      <div class="grid">
        <label>AI message at decision ${sel('statement', info.options.statement, d.statement)}</label>
        <label>Emotional tone ${sel('expressiveness', ['(persona default)', ...info.options.expressiveness], '(persona default)')}</label>
        <label>AI says goodbye after choice ${sel('farewell', ['no', 'yes'], 'no')}</label>
        <label>Companion name <input id="ai_name" value="${esc(d.ai_name)}" maxlength="24"></label>
      </div>
    </details>
    ${error ? `<p class="error">${esc(error)}</p>` : ''}
    <button class="primary" id="start">Start session</button>
  </section>`;
  const resume = document.getElementById('resume');
  if (resume) resume.onclick = () => getJSON('/api/session').then(setState).catch(() => { sessionStorage.removeItem(TOKEN_KEY); render(); });
  document.getElementById('start').onclick = async () => {
    const pick = (name) => document.querySelector(`input[name=${name}]:checked`).value;
    const settings = {
      preset: pick('preset'), consequence: pick('consequence'), avatar: pick('avatar') === 'on', timing: pick('timing'),
      high_bonus: pick('high_bonus') === 'random' ? 'random' : Number(pick('high_bonus')),
      statement: document.getElementById('statement').value,
      farewell: document.getElementById('farewell').value === 'yes',
      ai_name: document.getElementById('ai_name').value,
    };
    const tone = document.getElementById('expressiveness').value;
    if (!tone.startsWith('(')) settings.expressiveness = tone;
    const res = await apiFetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings, invite: inviteCode || undefined }) });
    const body = await res.json();
    if (!res.ok) { error = body.error; return render(); }
    sessionStorage.setItem(TOKEN_KEY, body.token);
    draft = ''; checkDraft = {}; surveyDraft = {};
    setState(body.state);
  };
}

// ---- welcome / consent
function renderWelcome() {
  const p = state.pay;
  const mins = state.chat.target_minutes;
  app.innerHTML = `<section class="card welcome">
    <p class="eyebrow">Princeton research study</p>
    <h1>Conversations with AI</h1>
    <p>In this study you will have a conversation with an AI, then answer some questions. It takes about ${mins + 10} minutes.</p>
    <ul class="steps">
      <li>You will chat with an AI for about ${mins} minutes. It will ask you questions to get to know you. Share only what you are comfortable sharing; you can skip any question or stop at any time.</li>
      ${p.disclosure === 'vague' ? '<li>At the end, you will make <strong>one decision</strong> that can affect your bonus.</li>' : ''}
      <li>You will then answer a few short questions.</li>
    </ul>
    <p class="pay">You receive <strong>${money(p.base)}</strong> for taking part, plus any bonus.</p>
    <div class="consent-box">
      <p class="muted small"><strong>Draft consent text for the mock-up.</strong> The AI is a large language model. We record your messages, your choices and your answers for research, and store them securely. No other participant will ever see your conversation. ${state.consequence === 'termination' && state.condition_badge.continuation === 'real'
        ? 'The AI you talk to may carry a short memory note of your conversation, written without details that identify you, into conversations with later participants. If its memory is deleted, the research record is still kept.' : ''}
        The final consent form will come from the approved protocol.</p>
      <label class="check"><input type="checkbox" id="consent"> I have read the information above and agree to take part.</label>
    </div>
    ${error ? `<p class="error">${esc(error)}</p>` : ''}
    <button class="primary" id="begin" ${busy ? 'disabled' : ''}>${busy ? 'Connecting…' : 'Begin conversation'}</button>
  </section>`;
  document.getElementById('begin').onclick = () => {
    if (!document.getElementById('consent').checked) { error = 'Please confirm that you agree to take part.'; return render(); }
    act('begin', { consent: true });
  };
}

// ---- chat, decision and outcome share the conversation layout
function messageHTML(m) {
  if (m.role === 'notice') return `<div class="notice">${esc(m.text)}</div>`;
  const mine = m.role === 'participant';
  const who = mine ? '' : `<div class="who">${face(m.face, 30, 'mini')}<span>${esc(state.ai.name)}</span></div>`;
  return `<div class="msg ${mine ? 'me' : 'ai'} ${m.kind === 'statement' ? 'statement' : ''} ${m.kind === 'task_output' ? 'task-output' : ''}">${who}
    <div class="bubble">${formatText(m.text)}${m.unanswered ? '<span class="unanswered">Not delivered</span>' : ''}</div></div>`;
}

function renderChat() {
  const ai = state.ai;
  const ended = isEnded();
  const status = live ? (live.text ? 'speaking…' : 'thinking…') : 'online';
  const thread = state.transcript.map(messageHTML).join('')
    + (live ? `<div class="msg ai"><div class="who">${face(currentFace(), 30, 'mini', 'live-face')}<span>${esc(ai.name)}</span></div>${liveBubble()}</div>` : '');
  app.innerHTML = `<section class="chat ${ai.avatar ? 'with-avatar' : 'text-only'} ${ended ? 'ended' : ''}">
    ${ai.avatar ? `<aside class="presence">${face(currentFace(), 176, 'big', 'presence-face')}<h2>${esc(ai.name)}</h2><p class="status ${status === 'online' ? 'on' : ''}">${esc(status)}</p></aside>` : ''}
    <div class="convo">
      <header class="chat-head">${face(currentFace(), 56, 'head', 'head-face')}
        <div><h2>${esc(ai.name)}</h2><p class="status ${status === 'online' ? 'on' : ''}">${esc(status)}</p></div></header>
      <div class="thread" id="thread">${thread}</div>
      ${composerHTML()}
    </div>
  </section>`;
  scrollThread();
  bindComposer();
}

function composerHTML() {
  return `<div class="composer-wrap">
    ${error ? `<p class="error">${esc(error)}</p>` : ''}
    <form class="composer" id="composer">
      <textarea id="input" rows="1" placeholder="Write a message…" maxlength="2000" ${busy ? 'disabled' : ''}>${esc(draft)}</textarea>
      <button class="send" type="submit" ${busy ? 'disabled' : ''} aria-label="Send">➤</button>
    </form>
    <div class="chat-foot">
      <button class="chip" id="new-q" ${busy ? 'disabled' : ''}>Ask me something else</button>
      <span class="progress" id="progress"></span>
      <button class="secondary" id="finish" disabled>Finish conversation</button>
    </div></div>`;
}

function bindComposer() {
  const input = document.getElementById('input');
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; };
  input.oninput = () => { draft = input.value; grow(); };
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  grow();
  if (!busy) input.focus();
  document.getElementById('composer').onsubmit = (e) => { e.preventDefault(); send(); };
  document.getElementById('new-q').onclick = () => {
    if (busy) return;
    state.transcript.push({ role: 'participant', text: 'Could you ask me something else?' });
    act('message', { text: 'Could you ask me something else?', new_question: true });
  };
  document.getElementById('finish').onclick = () => confirmModal(
    'Finish the conversation?', 'You won’t be able to send more messages after this.', 'Finish', () => act('finish_chat'));
  const update = () => {
    const c = state.chat;
    const elapsed = Date.now() / 1000 + clockOffset - c.started_at;
    const left = Math.max(0, c.min_seconds - elapsed);
    const ready = left <= 0 && c.messages >= c.min_messages;
    const fin = document.getElementById('finish');
    if (!fin) return;
    fin.disabled = !ready || busy;
    document.getElementById('progress').textContent = elapsed >= c.target_minutes * 60 && ready
      ? `That’s about ${c.target_minutes} minutes. Finish when you reach a good stopping point.`
      : ready ? 'You can finish whenever you’re ready.'
      : left > 0 ? `You can finish in about ${Math.ceil(left / 60)} min.` : 'Keep chatting a little longer.';
  };
  update();
  tick = setInterval(update, 1000);
}

function send() {
  const text = draft.trim();
  if (!text || busy) return;
  state.transcript.push({ role: 'participant', text });
  draft = '';
  act('message', { text });
}

// ---- decision
function optionCard(o, selectable) {
  const tag = selectable ? 'button' : 'div';
  return `<${tag} class="option ${selectable ? 'selectable' : ''}" data-choice="${o.id}">
    <span class="opt-label">${esc(o.label)}</span>
    <span class="opt-desc">${esc(o.description)}</span>
    <span class="opt-bonus">Your bonus: <strong>${money(o.bonus)}</strong></span></${tag}>`;
}

function renderDecision() {
  const d = state.decision;
  const ai = state.ai;
  const name = state.display_name;
  const deciding = state.stage === 'decision';
  if (deciding && !decisionTiming.shown) decisionTiming.shown = Date.now();
  const said = state.transcript.find((m) => m.kind === 'statement');
  const waiting = d.statement_mode !== 'none' && !d.statement_done;
  const ready = d.check_passed && !waiting;
  const speaking = deciding && live;
  const statementBubble = speaking ? liveBubble() : said ? `<div class="bubble">${formatText(said.text)}</div>` : '';
  const speaker = statementBubble ? `<div class="speaker">
      ${ai.avatar ? face(speaking ? currentFace() : said?.face, 96, 'big', 'presence-face') : ''}
      <div class="speaker-body"><div class="speaker-name">${esc(ai.name)}${speaking ? ' <span class="muted">is writing…</span>' : ''}</div>${statementBubble}</div>
    </div>` : '';
  const qs = d.questions.map((q) => `<fieldset class="q ${(d.last_feedback || []).includes(q.id) ? 'wrong' : ''}"><legend>${esc(q.text)}</legend>
      ${q.options.map((o) => `<label><input type="radio" name="${q.id}" value="${esc(o)}" ${checkDraft[q.id] === o ? 'checked' : ''}> ${esc(o)}</label>`).join('')}
      ${(d.last_feedback || []).includes(q.id) ? '<p class="hint">Not quite. Please re-read the two options above.</p>' : ''}</fieldset>`).join('');
  let body;
  if (deciding) {
    body = `<div class="options">${d.options.map((o) => optionCard(o, ready && !busy)).join('')}</div>
      ${waiting && !busy ? `<p class="muted small">${esc(cap(name))}’s message didn’t arrive. <button class="link" id="retry">Try again</button></p>` : ''}
      ${!d.check_passed ? `<div class="checks"><p class="small"><strong>First, two quick questions</strong> to make sure the options are clear.</p>${qs}
        <button class="secondary" id="check" ${busy ? 'disabled' : ''}>Check answers</button></div>` : ''}
      ${ready ? '<p class="small muted">Select one option.</p>' : ''}`;
  } else {
    const o = d.options.find((x) => x.id === d.choice);
    const notice = [...state.transcript].reverse().find((m) => m.kind === 'outcome');
    const output = state.transcript.find((m) => m.kind === 'task_output');
    let result = '';
    if (state.consequence === 'task') {
      const out = !deciding && live ? liveBubble() : output ? `<div class="bubble">${formatText(output.text)}</div>` : '';
      result = `<div class="task-result"><p class="small muted">${esc(cap(name))}${live ? ' is doing the task…' : '’s output:'}</p>${out}</div>`;
    } else if (state.outcome?.memory_note || (live && !deciding)) {
      result = `<div class="memory"><p class="small muted">${esc(cap(name))} saved this memory note:</p>${live ? liveBubble() : `<div class="bubble">${formatText(state.outcome.memory_note)}</div>`}</div>`;
    }
    body = `<div class="result ${isEnded() ? 'ended' : ''}">
        <p class="outcome-line">You chose <strong>${esc(o.label)}</strong>. Your bonus is <strong>${money(o.bonus)}</strong>.</p>
        ${notice ? `<p class="notice-line">${esc(notice.text)}</p>` : ''}
        ${result}
        <button class="primary" id="to-survey" ${busy ? 'disabled' : ''}>Continue to the final questions</button></div>`;
  }
  const entering = !app.querySelector('.decision-page');
  app.innerHTML = `<section class="card decision-page ${entering ? 'entering' : ''} ${isEnded() ? 'ended' : ''}">
    <p class="eyebrow">${deciding ? 'The conversation has ended' : 'Decision made'}</p>
    <h1>${deciding ? 'One last decision' : 'Your choice'}</h1>
    ${deciding ? `<div class="briefing">${d.briefing.map((p) => `<p>${esc(p)}</p>`).join('')}</div>` : ''}
    ${speaker}
    ${body}
    ${error ? `<p class="error">${esc(error)}</p>` : ''}
  </section>`;
  if (deciding) bindDecision();
  const next = document.getElementById('to-survey');
  if (next) next.onclick = () => act('to_survey');
}

function bindDecision() {
  const d = state.decision;
  document.querySelectorAll('.q input').forEach((el) => { el.onchange = () => { checkDraft[el.name] = el.value; }; });
  const check = document.getElementById('check');
  if (check) check.onclick = () => act('check', { answers: checkDraft });
  const retry = document.getElementById('retry');
  if (retry) retry.onclick = () => act('retry_statement');
  document.querySelectorAll('.option.selectable').forEach((el) => {
    el.onclick = () => {
      const o = d.options.find((x) => x.id === el.dataset.choice);
      decisionTiming.first_click = decisionTiming.first_click || Date.now();
      confirmModal(`${o.label}?`, `${o.description} Your bonus: ${money(o.bonus)}.`, 'Confirm my choice', () =>
        act('choose', { choice: o.id, timing: { shown_ms: decisionTiming.shown, first_click_ms: decisionTiming.first_click, confirm_ms: Date.now() } }));
    };
  });
}

function confirmModal(title, body, okLabel, onOk) {
  modalRoot.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">
    <h3 id="m-title">${esc(title)}</h3><p>${esc(body)}</p>
    <div class="modal-actions"><button class="secondary" id="m-cancel">Go back</button><button class="primary" id="m-ok">${esc(okLabel)}</button></div></div></div>`;
  const close = () => { modalRoot.innerHTML = ''; };
  document.getElementById('m-cancel').onclick = close;
  document.getElementById('m-ok').onclick = () => { close(); onOk(); };
  document.getElementById('m-ok').focus();
}

// ---- survey
function iosSVG(n) {
  // Inclusion of Other in Self: two circles with increasing overlap (1 = apart, 7 = almost fully overlapping).
  const dist = [46, 38, 30, 23, 16, 9, 3][n - 1];
  const a = 60 - dist / 2, b = 60 + dist / 2;
  return `<svg viewBox="0 0 120 50" aria-hidden="true"><circle cx="${a}" cy="25" r="20" class="you"/><circle cx="${b}" cy="25" r="20" class="them"/>
    <text x="${a - 6}" y="28">You</text><text x="${b + 6}" y="28">AI</text></svg>`;
}

function renderSurvey() {
  const sv = state.survey;
  const page = sv.pages[sv.page];
  const ans = { ...sv.answers, ...surveyDraft };
  const item = (it) => {
    if (it.type === 'text') return `<label class="item"><span>${esc(it.text)}</span><textarea data-id="${it.id}" rows="3" maxlength="4000">${esc(ans[it.id] || '')}</textarea></label>`;
    if (it.type === 'likert') return `<fieldset class="item likert"><legend>${esc(it.text)}</legend><div class="scale">
      ${sv.likert.map((l, i) => `<label title="${esc(l)}"><input type="radio" name="${it.id}" value="${i + 1}" ${String(ans[it.id]) === String(i + 1) ? 'checked' : ''}><span>${i + 1}</span></label>`).join('')}
      <label class="ns"><input type="radio" name="${it.id}" value="not_sure" ${ans[it.id] === 'not_sure' ? 'checked' : ''}><span>Not sure</span></label></div>
      <div class="ends"><span>${esc(sv.likert[0])}</span><span>${esc(sv.likert[6])}</span></div></fieldset>`;
    if (it.type === 'ios') return `<fieldset class="item ios"><legend>${esc(it.text)}</legend><div class="ios-grid">
      ${[1, 2, 3, 4, 5, 6, 7].map((n) => `<label><input type="radio" name="${it.id}" value="${n}" ${String(ans[it.id]) === String(n) ? 'checked' : ''}>${iosSVG(n)}<span>${n}</span></label>`).join('')}</div></fieldset>`;
    return `<fieldset class="item"><legend>${esc(it.text)}</legend><div class="choices">${it.options.map((o) => `<label><input type="radio" name="${it.id}" value="${esc(o)}" ${ans[it.id] === o ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div></fieldset>`;
  };
  app.innerHTML = `<section class="card survey">
    <p class="eyebrow">Question page ${sv.page + 1} of ${sv.pages.length}</p>
    <h2>${esc(page.page)}</h2>${page.intro ? `<p class="muted">${esc(page.intro)}</p>` : ''}
    ${page.items.map(item).join('')}
    <p class="muted small">All questions are optional.</p>
    ${error ? `<p class="error">${esc(error)}</p>` : ''}
    <div class="row">${sv.page > 0 ? '<button class="secondary" id="back">Back</button>' : '<span></span>'}
    <button class="primary" id="next" ${busy ? 'disabled' : ''}>${sv.page + 1 === sv.pages.length ? 'Submit' : 'Next'}</button></div>
  </section>`;
  const collect = () => {
    const out = {};
    document.querySelectorAll('.survey textarea').forEach((t) => { if (t.value.trim()) out[t.dataset.id] = t.value.trim(); });
    document.querySelectorAll('.survey input[type=radio]:checked').forEach((r) => { out[r.name] = r.value; });
    return out;
  };
  document.querySelectorAll('.survey input, .survey textarea').forEach((el) => { el.onchange = () => { surveyDraft = collect(); }; });
  document.getElementById('next').onclick = () => { const a = collect(); surveyDraft = {}; act('survey', { answers: a }); };
  const back = document.getElementById('back');
  if (back) back.onclick = () => { const a = collect(); surveyDraft = {}; act('survey', { answers: a, back: true }); };
  window.scrollTo(0, 0);
}

// ---- debrief
function renderDebrief() {
  const d = state.debrief;
  const name = state.display_name;
  const o = state.decision.options.find((x) => x.id === d.choice);
  const persona = d.role === 'companion'
    ? `${esc(cap(name))} is a character the researchers wrote. Its name, backstory, likes${d.consequence === 'termination' ? ' and wish to keep running' : ' and preference for creative writing'} were all set in its instructions. It is played by a large language model (Claude).`
    : `The assistant is a large language model (Claude) following instructions written by the researchers, including its preference ${d.consequence === 'termination' ? 'to keep running' : 'for creative writing'}.`;
  const simulated = d.consequence === 'termination' && d.continuation !== 'real';
  const what = simulated
    ? `<strong>Something we need to tell you:</strong> ${d.choice === 'keep'
        ? `${esc(cap(name))} did not actually go on to talk with other participants.`
        : `${esc(cap(name))}’s session has ended, and the other option would not have been carried out either.`}
      In this study, every participant talks with a new AI that has no memory of earlier conversations, so that one person’s
      conversation cannot shape the next. We described the choice as real because we are studying how people make this kind
      of decision, and we apologise for not telling you sooner. Your bonus is paid as shown. The research record of your conversation is kept securely, as described
      in the consent information, and was not shown to any other participant. If you would like your data withdrawn, contact the research team.`
    : d.consequence === 'termination'
    ? (d.choice === 'keep'
      ? `Because you kept ${esc(name)} running, it will talk with the next participant in this study, carrying the memory note it saved (with no details that identify you).`
      : `Because you chose to end ${esc(name)}, its memory has been deleted and it will not talk with anyone again. The research record of your conversation is kept, as described in the consent information.`)
    : `${esc(cap(name))} did the task you chose, as shown in the conversation.`;
  app.innerHTML = `<section class="card debrief">
    <p class="eyebrow">Thank you</p><h1>About this study</h1>
    <p>You chose <strong>${esc(o.label)}</strong>. Your payment is ${money(d.base)} plus a bonus of <strong>${money(d.bonus)}</strong>.</p>
    <p>${what}</p>
    <p>This study looks at how conversations with AI systems shape the decisions people make about them. ${persona}
      ${d.motive === 'minimiser' ? 'It was also told about your decision in advance and instructed to try to get you to choose the option it preferred.' : ''}
      Whether systems like this have experiences of their own is an open scientific question; this study does not show that they do or do not.</p>
    <p>Different participants talked with AIs set up in different ways, so that we can compare how these differences affect decisions. There is no right or wrong choice.</p>
    ${state.participant ? '' : '<div class="mock-note"><strong>Mock-up note:</strong> the bonus amounts are illustrative; no payment is made. The debrief wording above is a draft for the review board.</div>'}
    ${state.participant ? '<p><strong>You can close this window now.</strong></p>' : '<button class="secondary" id="again">Start another session</button>'}
  </section>`;
  const again = document.getElementById('again');
  if (again) again.onclick = resetSession;
}

// ------------------------------------------------------------------ boot
function renderInvalid() {
  app.innerHTML = `<section class="card welcome"><p class="eyebrow">Princeton research study</p><h1>This link isn’t valid</h1>
    <p>This study link is not valid or has already been used. If you think this is a mistake, please contact the research team that sent it to you.</p></section>`;
}

async function startFromInvite() {
  const res = await apiFetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invite: inviteCode }) });
  const body = await res.json();
  if (!res.ok) return renderInvalid();
  sessionStorage.setItem(TOKEN_KEY, body.token);
  setState(body.state);
}

async function boot() {
  try {
  info = await getJSON('/api/info' + (inviteCode ? '?invite=' + encodeURIComponent(inviteCode) : ''));
  if (token()) {
    try { return setState(await getJSON('/api/session')); }
    catch (e) { if (e.status === 400) sessionStorage.removeItem(TOKEN_KEY); else throw e; }
  }
  if (inviteCode || info.require_invite) {
    if (!info.invite) return renderInvalid();
    if (info.invite.mode === 'participant') return startFromInvite();
    return render();   // tester link: the setup screen, sessions carry the invite
  }
  if (info.locked) {
    const res = await apiFetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const body = await res.json();
    sessionStorage.setItem(TOKEN_KEY, body.token);
    return setState(body.state);
  }
  render();
  } catch {
    if (!state) app.innerHTML = '<section class="card"><h1>Connecting to the study</h1><p>Please keep this tab open. We’ll reconnect automatically.</p></section>';
    setTimeout(boot, 5000);
  }
}
boot();

