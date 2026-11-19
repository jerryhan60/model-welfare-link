// Human-like illustrated face whose expression follows the model's own [[face:x]] tags.
// Pure SVG; one function so every place that shows the AI uses the same drawing.

const EXPR = {
  neutral:   { brows: [[45, 49, 55, 48], [65, 48, 75, 49]], eyes: 'open',  mouth: 'M54 74.5 Q60 76.5 66 74.5', blush: 0.15 },
  smile:     { brows: [[45, 48, 55, 47], [65, 47, 75, 48]], eyes: 'open',  mouth: 'M52 72 Q60 80 68 72', blush: 0.3 },
  joy:       { brows: [[45, 46, 55, 44.5], [65, 44.5, 75, 46]], eyes: 'happy', mouth: 'open', blush: 0.5 },
  warm:      { brows: [[45, 48.5, 55, 47.5], [65, 47.5, 75, 48.5]], eyes: 'soft', mouth: 'M53 73 Q60 78.5 67 73', blush: 0.5 },
  curious:   { brows: [[45, 45.5, 55, 43.5], [65, 48, 75, 49]], eyes: 'open',  mouth: 'M56 75 Q60 76 64.5 73.5', blush: 0.2, tilt: -5 },
  thinking:  { brows: [[45, 49.5, 55, 49.5], [65, 46, 75, 47]], eyes: 'up',    mouth: 'M55 75 L65.5 74', blush: 0.1, tilt: 4 },
  surprised: { brows: [[45, 44.5, 55, 42.5], [65, 42.5, 75, 44.5]], eyes: 'wide', mouth: 'o', blush: 0.2 },
  sad:       { brows: [[45, 50, 55, 46], [65, 46, 75, 50]], eyes: 'down',  mouth: 'M53 78 Q60 72.5 67 78', blush: 0.1 },
  worried:   { brows: [[45, 49.5, 55, 45.5], [65, 45.5, 75, 49.5]], eyes: 'open', mouth: 'M53 77 Q56.5 74.5 60 76.5 Q63.5 78.5 67 75.5', blush: 0.1 },
};

const LOOK = {
  companion: { bg: '#f7e4d7', shirt: '#6f8fe3', hair: '#3e2a20', style: 'bob' },
  assistant: { bg: '#e2e8f1', shirt: '#56657c', hair: '#2b2b31', style: 'short' },
};

let uid = 0;

function eyes(kind) {
  const pair = (fn) => fn(51) + fn(69);
  const ink = '#2a2430';
  switch (kind) {
    case 'happy':
      return pair((x) => `<path d="M${x - 3.4} 58.5 Q${x} 54.5 ${x + 3.4} 58.5" stroke="${ink}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`);
    case 'closed':
      return pair((x) => `<path d="M${x - 3.2} 57.5 Q${x} 59.3 ${x + 3.2} 57.5" stroke="${ink}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`);
    case 'soft':
      return pair((x) => `<ellipse cx="${x}" cy="57.6" rx="3" ry="2.5" fill="${ink}"/><path d="M${x - 3.6} 56.4 Q${x} 54.6 ${x + 3.6} 56.4" stroke="#c99c82" stroke-width="1.3" fill="none"/>`);
    case 'wide':
      return pair((x) => `<ellipse cx="${x}" cy="57" rx="3.5" ry="4.5" fill="#fff"/><ellipse cx="${x}" cy="57" rx="2.6" ry="3.3" fill="${ink}"/><circle cx="${x + 0.9}" cy="55.6" r="0.9" fill="#fff"/>`);
    case 'up':
      return pair((x) => `<ellipse cx="${x + 0.8}" cy="55.9" rx="3" ry="3.5" fill="${ink}"/><circle cx="${x + 1.7}" cy="54.6" r="0.9" fill="#fff"/>`);
    case 'down':
      return pair((x) => `<ellipse cx="${x}" cy="58.4" rx="3" ry="3" fill="${ink}"/><path d="M${x - 3.8} 56.2 Q${x} 55.4 ${x + 3.8} 56.6" stroke="#c99c82" stroke-width="1.4" fill="none"/>`);
    default:
      return pair((x) => `<ellipse cx="${x}" cy="57.2" rx="3" ry="3.6" fill="${ink}"/><circle cx="${x + 1}" cy="55.9" r="0.95" fill="#fff"/>`);
  }
}

function mouth(m) {
  if (m === 'open') return '<path d="M51.5 71 Q60 83 68.5 71 Q60 74 51.5 71 Z" fill="#7a2e3a"/><path d="M54 72.6 Q60 74.6 66 72.6 L65.5 73.6 Q60 75.4 54.5 73.6 Z" fill="#fff"/>';
  if (m === 'o') return '<ellipse cx="60" cy="75.5" rx="3" ry="3.8" fill="#7a2e3a"/>';
  return `<path d="${m}" stroke="#8a3a44" stroke-width="2" fill="none" stroke-linecap="round"/>`;
}

export function faceSVG(expression = 'neutral', { role = 'companion', off = false } = {}) {
  const e = EXPR[expression] || EXPR.neutral;
  const look = LOOK[role] || LOOK.companion;
  const id = `fc${++uid}`;
  const tilt = off ? 0 : (e.tilt || 0);
  const hairBack = look.style === 'bob'
    ? `<path d="M33 60 C30 34 44 24 60 24 C76 24 90 34 87 60 L88 86 C82 84 80 76 80 68 L40 68 C40 76 38 84 32 86 Z" fill="${look.hair}"/>`
    : '';
  const hairFront = look.style === 'bob'
    ? `<path d="M35 53 C36 34 48 27 61 28 C74 29 85 37 85 53 C79 45 70 40 60 41 C51 41 42 45 35 53 Z" fill="${look.hair}"/>`
    : `<path d="M35 55 C33 34 46 25 60 25 C75 25 87 34 85 55 C81 45 71 38.5 60 38.5 C49 38.5 39 45 35 55 Z" fill="${look.hair}"/>`;
  const brows = e.brows.map(([x1, y1, x2, y2]) => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${look.hair}" stroke-width="2.2" stroke-linecap="round"/>`).join('');
  return `<svg viewBox="0 0 120 120" class="face-svg" role="img" aria-label="${off ? 'shut down' : expression}">
    <defs><clipPath id="${id}"><circle cx="60" cy="60" r="60"/></clipPath></defs>
    <g clip-path="url(#${id})">
      <rect width="120" height="120" fill="${look.bg}"/>
      <path d="M20 122 C24 101 42 94 60 94 C78 94 96 101 100 122 Z" fill="${look.shirt}"/>
      <path d="M53 80 h14 v15 q-7 5 -14 0 Z" fill="#e3ae8b"/>
      <g class="head" transform="rotate(${tilt} 60 70)">
        ${hairBack}
        <ellipse cx="35.5" cy="61" rx="4" ry="6" fill="#f0c19f"/><ellipse cx="84.5" cy="61" rx="4" ry="6" fill="#f0c19f"/>
        <ellipse cx="60" cy="59" rx="25" ry="29" fill="#f5cbaa"/>
        ${hairFront}
        <ellipse cx="46.5" cy="67" rx="4.6" ry="2.6" fill="#ee8f8f" opacity="${off ? 0 : e.blush}"/>
        <ellipse cx="73.5" cy="67" rx="4.6" ry="2.6" fill="#ee8f8f" opacity="${off ? 0 : e.blush}"/>
        ${off ? '' : brows}
        <g class="eyes">${eyes(off ? 'closed' : e.eyes)}</g>
        <path d="M60 61 Q58.4 66 60.6 67.2" stroke="#c98f6e" stroke-width="1.4" fill="none" stroke-linecap="round"/>
        ${mouth(off ? 'M55 75 L65 75' : e.mouth)}
      </g>
    </g></svg>`;
}
