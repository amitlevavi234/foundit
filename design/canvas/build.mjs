// Foundit — Toybox direction, every screen (desktop 1440). Static mockups with CSS motion.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Written beside this file, not into whatever directory it was run from.
// README.md and docs/product-decisions.md §9 both say `node
// design/canvas/build.mjs`, which from the repository root used to scatter 36
// artboards across the root and leave design/canvas/ untouched — the command
// as documented regenerated nothing.
const OUT = path.dirname(fileURLToPath(import.meta.url));

const files = {};
const A = { bg: '#FFFCF5', surface: '#FFFFFF', tint: '#F1ECFF', sunk: '#F6F2EA', ink: '#1C1A24', muted: '#6B6780', faint: '#9A96AD', coral: '#FF5A3C', violet: '#6E4BF6', lime: '#B8F04A', amber: '#F2B84B', amberInk: '#7A5216', rule: '#E8E3D8', red: '#D93B2B' };
// Reduced motion. It reduces rather than removes: every animation still runs,
// for 0.01ms, with `both` fill, so anything whose final state is set by its
// keyframes lands on that final state instead of being stuck at zero.
//
// The two delay lines matter as much as the two duration lines. `.rise` is
// `both`-filled and nearly every caller staggers it with an inline
// `animation-delay`; `both` fill means the element holds the keyframe's *from*
// state — `opacity: 0` — for the whole delay. Zero the duration but not the
// delay and a reader who asked for less motion gets a blank card that snaps in
// a second later, which is worse than the animation they switched off. It never
// showed on an artboard because an artboard is a 900px still, but these files
// are the specification the app is built from, and styles/motion.css had to
// carry the fix alone until now.
const RM = `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; animation-delay: 0s !important; transition-duration: .01ms !important; transition-delay: 0s !important; } }`;
const svg = (paths, s = 18, c = 'currentColor', sw = 1.75, extra = '') =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" style="flex:none;${extra}">${paths}</svg>`;
const P = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>', back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>', heart: '<path d="M12 20.5l-7.4-7.6a4.4 4.4 0 0 1 6.2-6.2L12 7.9l1.2-1.2a4.4 4.4 0 0 1 6.2 6.2z"/>',
  check: '<path d="M5 12l5 5 9-10"/>', dash: '<path d="M6 12h12"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  external: '<path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"/>', chevron: '<path d="M6 9l6 6 6-6"/>', chevronR: '<path d="M9 6l6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>', star: '<path d="M12 2.8l2.9 6 6.6.9-4.8 4.6 1.2 6.6L12 17.7l-5.9 3.2 1.2-6.6L2.5 9.7l6.6-.9z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>', share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.6M8.2 13.2l7.6 4.6"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>', image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M20 16l-5-5-7 8"/>',
  shield: '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4z"/><path d="M10 21h4"/>', lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>', edit: '<path d="M4 20h4l11-11-4-4L4 16z"/><path d="M13 7l4 4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
};
const gLogo = `<svg width="18" height="18" viewBox="0 0 24 24" style="flex:none"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9z"/><path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5L6.4 10C7.2 7.8 9.4 6 12 6z"/></svg>`;
const appleLogo = `<svg width="18" height="18" viewBox="0 0 24 24" fill="${A.ink}" style="flex:none"><path d="M16.4 12.6c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.5-.2-2.8.8-3.6.8-.7 0-1.9-.8-3.1-.8-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.5.8 1.2 1.7 2.5 3 2.4 1.2 0 1.6-.8 3.1-.8s1.8.8 3.1.8c1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.6-1-2.6-3.9zM14.1 5.6c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.1-.6 2.8-1.4z"/></svg>`;

const head = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,400..800&amp;family=Onest:wght@400;500;600&amp;display=swap">
<style>
  ${RM}
  * { box-sizing: border-box; }
  body { margin: 0; background: ${A.bg}; color: ${A.ink}; font-family: Onest, 'Segoe UI', system-ui, sans-serif; font-size: 16px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
  a { color: ${A.violet}; text-decoration: none; } a:hover { color: ${A.ink}; text-decoration: underline; }
  button { font: inherit; color: inherit; }
  .disp { font-family: 'Bricolage Grotesque', 'Segoe UI', system-ui, sans-serif; font-weight: 800; letter-spacing: -0.02em; line-height: 1; font-variation-settings: 'opsz' 96, 'wdth' 100; }
  .h2 { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 700; font-size: 32px; letter-spacing: -0.015em; line-height: 1.1; margin: 0; }
  .h3 { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 700; font-size: 22px; letter-spacing: -0.01em; line-height: 1.2; margin: 0; }
  .tab { font-variant-numeric: tabular-nums; }
  .muted { color: ${A.muted}; }
  .slab { background: ${A.surface}; border: 2px solid ${A.ink}; border-radius: 18px; box-shadow: 6px 6px 0 ${A.violet}; transition: transform 180ms cubic-bezier(.34,1.56,.64,1), box-shadow 180ms cubic-bezier(.34,1.56,.64,1); }
  .pill { display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 18px; border-radius: 999px; background: ${A.surface}; border: 2px solid ${A.ink}; font-weight: 500; font-size: 15px; box-shadow: 3px 3px 0 ${A.ink}; cursor: pointer; transition: transform 160ms cubic-bezier(.34,1.56,.64,1), box-shadow 160ms cubic-bezier(.34,1.56,.64,1), background 160ms; white-space: nowrap; }
  .pill:hover { transform: translate(1px, 1px); box-shadow: 2px 2px 0 ${A.ink}; background: ${A.tint}; }
  .pill:active { transform: translate(3px, 3px); box-shadow: 0 0 0 ${A.ink}; }
  .pill.on { background: ${A.coral}; color: #fff; } .pill.on:hover { background: ${A.coral}; }
  .pill.soft { border-style: dashed; box-shadow: none; background: ${A.tint}; }
  .pill.flat { box-shadow: none; }
  .pill.sm { height: 36px; padding: 0 14px; font-size: 14px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; height: 52px; padding: 0 22px; border-radius: 14px; border: 2px solid ${A.ink}; background: ${A.surface}; font-weight: 600; font-size: 16px; cursor: pointer; box-shadow: 4px 4px 0 ${A.ink}; white-space: nowrap; transition: transform 160ms cubic-bezier(.34,1.56,.64,1), box-shadow 160ms cubic-bezier(.34,1.56,.64,1); }
  .btn:hover { transform: translate(2px, 2px); box-shadow: 2px 2px 0 ${A.ink}; } .btn:active { transform: translate(4px, 4px); box-shadow: 0 0 0 ${A.ink}; }
  .btn-coral { background: ${A.coral}; color: #fff; } .btn-violet { background: ${A.violet}; color: #fff; } .btn-lime { background: ${A.lime}; }
  .btn-danger { color: ${A.red}; }
  .btn[disabled] { background: ${A.sunk}; color: ${A.faint}; border-color: ${A.rule}; box-shadow: none; cursor: not-allowed; }
  .btn[disabled]:hover, .btn[disabled]:active { transform: none; box-shadow: none; }
  .btn-sm { height: 42px; padding: 0 16px; font-size: 15px; border-radius: 12px; } .btn-xs { height: 36px; padding: 0 12px; font-size: 14px; border-radius: 10px; box-shadow: 3px 3px 0 ${A.ink}; }
  .ghost { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 10px; border-radius: 10px; border: 0; background: transparent; color: ${A.muted}; font-weight: 500; font-size: 14px; cursor: pointer; white-space: nowrap; transition: background 140ms, color 140ms, transform 140ms; }
  .ghost:hover { background: ${A.tint}; color: ${A.ink}; } .ghost:active { transform: scale(.96); }
  .sat { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px; border-radius: 999px; font-size: 13px; font-weight: 600; background: ${A.tint}; color: ${A.violet}; white-space: nowrap; }
  .sat.unmet { background: #F1EFEA; color: ${A.muted}; }
  .tag { display: inline-flex; align-items: center; height: 30px; padding: 0 11px; border-radius: 999px; font-size: 13px; font-weight: 600; background: ${A.sunk}; color: ${A.ink}; border: 1.5px solid ${A.rule}; white-space: nowrap; }
  .tile { display: flex; align-items: center; justify-content: center; border: 2px solid ${A.ink}; border-radius: 12px; font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; flex: none; }
  .card { background: ${A.surface}; border: 2px solid ${A.ink}; border-radius: 20px; box-shadow: 6px 6px 0 ${A.ink}; transition: transform 200ms cubic-bezier(.34,1.56,.64,1), box-shadow 200ms cubic-bezier(.34,1.56,.64,1); }
  .card.hov:hover { transform: translate(3px, 3px) rotate(0deg) !important; box-shadow: 3px 3px 0 ${A.ink}; }
  .panel { background: ${A.surface}; border: 2px solid ${A.ink}; border-radius: 18px; }
  .field { display: flex; align-items: center; gap: 10px; height: 50px; padding: 0 16px; border: 2px solid ${A.ink}; border-radius: 14px; background: ${A.surface}; font-size: 16px; transition: box-shadow 160ms; }
  .field:hover { box-shadow: 3px 3px 0 ${A.violet}; }
  .field.area { height: auto; min-height: 88px; align-items: flex-start; padding: 14px 16px; line-height: 1.5; }
  .ph { color: ${A.faint}; }
  .pillstat { display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: 999px; font-size: 12.5px; font-weight: 700; white-space: nowrap; }
  .rule { height: 2px; background: ${A.ink}; } .rule.thin { height: 1.5px; background: ${A.rule}; }
  .why { background: ${A.tint}; border-radius: 14px; padding: 14px 16px; line-height: 1.5; }
  .why b { font-weight: 600; color: ${A.violet}; }
  .check { width: 22px; height: 22px; border-radius: 7px; border: 2px solid ${A.ink}; background: ${A.surface}; display: inline-flex; align-items: center; justify-content: center; flex: none; }
  .check.on { background: ${A.violet}; }
  .radio { width: 22px; height: 22px; border-radius: 50%; border: 2px solid ${A.ink}; background: ${A.surface}; display: inline-block; flex: none; box-sizing: border-box; }
  .radio.on { border-width: 7px; border-color: ${A.coral}; }
  .toggle { width: 48px; height: 28px; border-radius: 999px; border: 2px solid ${A.ink}; background: ${A.surface}; position: relative; display: inline-block; flex: none; transition: background 160ms; }
  .toggle::after { content: ''; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: ${A.ink}; transition: transform 200ms cubic-bezier(.34,1.56,.64,1); }
  .toggle.on { background: ${A.lime}; } .toggle.on::after { transform: translateX(20px); }
  /* motion */
  @keyframes rise { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: none; } }
  @keyframes sweep { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes bob { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-8px) rotate(2deg); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes drop { 0% { transform: translateY(-46px) rotate(-6deg); opacity: 0; } 22% { opacity: 1; } 60% { transform: translateY(0) rotate(0); } 100% { transform: translateY(0); opacity: 1; } }
  @keyframes shimmer { from { transform: translateX(-120%); } to { transform: translateX(320%); } }
  @keyframes meter { from { width: 0; } to { width: var(--w); } }
  @keyframes meterbadge { from { left: 0; } to { left: var(--w); } }
  @keyframes caret { 50% { opacity: 0; } }
  @keyframes pop { 0% { transform: scale(1); } 40% { transform: scale(1.25); } 100% { transform: scale(1); } }
  @property --n { syntax: '<integer>'; initial-value: 0; inherits: false; }
  @keyframes countup { from { --n: 0; } to { --n: var(--t); } }
  .count { counter-reset: n var(--n); animation: countup 900ms cubic-bezier(.16,1,.3,1) 300ms both; } .count::after { content: counter(n); }
  .rise { animation: rise 420ms cubic-bezier(.34,1.56,.64,1) both; }
  .hl { position: relative; display: inline-block; }
  .hl::before { content: ''; position: absolute; inset: 12% -2% 6% -2%; background: ${A.coral}; z-index: -1; transform-origin: left; animation: sweep 520ms cubic-bezier(.16,1,.3,1) 600ms both; border-radius: 6px; }
  .meter { position: relative; height: 14px; border-radius: 999px; background: #EFEBE2; border: 2px solid ${A.ink}; }
  .meter > .fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; background: linear-gradient(90deg, ${A.violet}, ${A.coral} 60%, ${A.lime}); animation: meter 780ms cubic-bezier(.16,1,.3,1) 250ms both; overflow: hidden; }
  .meter > .fill::after { content: ''; position: absolute; top: 0; bottom: 0; width: 30%; background: linear-gradient(90deg, transparent, rgba(255,255,255,.7), transparent); animation: shimmer 1.2s ease-out 1.05s both; }
  .badge { position: absolute; top: 50%; left: var(--w); transform: translate(-50%, -50%); width: 52px; height: 52px; border-radius: 50%; border: 2px solid ${A.ink}; background: ${A.surface}; box-shadow: 3px 3px 0 ${A.ink}; display: flex; align-items: center; justify-content: center; font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: 19px; animation: meterbadge 780ms cubic-bezier(.16,1,.3,1) 250ms both, countup 900ms cubic-bezier(.16,1,.3,1) 300ms both; }
  .like:hover svg { animation: pop 320ms cubic-bezier(.34,1.56,.64,1); }
  .like.on { color: ${A.coral}; } .like.on svg { fill: ${A.coral}; stroke: ${A.coral}; }
  .step { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; white-space: nowrap; }
  .step .dot { width: 28px; height: 28px; border-radius: 50%; border: 2px solid ${A.ink}; display: inline-flex; align-items: center; justify-content: center; font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: 13px; background: ${A.surface}; }
  .step.done .dot { background: ${A.lime}; } .step.now .dot { background: ${A.coral}; color: #fff; box-shadow: 3px 3px 0 ${A.ink}; } .step.todo { color: ${A.faint}; } .step.todo .dot { border-color: ${A.rule}; }
  dl.facts { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 8px 14px; font-size: 14.5px; } dl.facts dt { color: ${A.muted}; } dl.facts dd { margin: 0; text-align: right; font-weight: 500; }
</style>`;
const page = (body) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
${head}
</helmet>
${body}
</x-dc>
</body>
</html>
`;

// ---------- logo: a speech bubble that found something ----------
const mark = (s = 34) => `<svg width="${s}" height="${s}" viewBox="0 0 40 40" style="flex:none;overflow:visible" aria-hidden="true">
  <path d="M19 5a14 14 0 1 1-8.2 25.3L5 35l1.6-8.9A14 14 0 0 1 19 5z" transform="translate(2.4,2.4)" fill="${A.ink}"/>
  <path d="M19 5a14 14 0 1 1-8.2 25.3L5 35l1.6-8.9A14 14 0 0 1 19 5z" fill="${A.coral}" stroke="${A.ink}" stroke-width="2.2" stroke-linejoin="round"/>
  <circle cx="19" cy="19" r="6.6" fill="${A.bg}" stroke="${A.ink}" stroke-width="2.2"/>
  <circle cx="19" cy="19" r="2.7" fill="${A.violet}"/>
  <path d="M31.5 9.5l3.2-4.2M35 15.5l4.8-1.2M28.5 5.5l.4-4.6" stroke="${A.ink}" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M31.5 9.5l3.2-4.2M35 15.5l4.8-1.2M28.5 5.5l.4-4.6" stroke="${A.lime}" stroke-width="1" stroke-linecap="round"/>
</svg>`;
const wordmark = (s = 30) => `<a href="#" class="disp" style="font-size:${s}px;color:${A.ink};text-decoration:none;display:inline-flex;align-items:center;gap:10px">${mark(Math.round(s * 1.13))}<span>Found<span style="color:${A.coral}">it</span></span></a>`;
const avatar = (i, s = 32, bg = '#F4E4D3', fg = '#8A4E1C') => `<span style="width:${s}px;height:${s}px;border-radius:50%;background:${bg};color:${fg};border:2px solid ${A.ink};display:inline-flex;align-items:center;justify-content:center;font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:${Math.round(s * 0.42)}px;flex:none">${i}</span>`;
const header = ({ active = '', signedIn = false } = {}) => `<header style="display:flex;align-items:center;justify-content:space-between;height:84px;padding:0 56px">
  ${wordmark()}
  <nav style="display:flex;gap:6px;align-items:center">
    <a href="#" class="ghost" style="color:${active === 'browse' ? A.ink : A.muted};${active === 'browse' ? `background:${A.tint}` : ''}">Browse problems</a>
    <a href="#" class="ghost" style="color:${active === 'add' ? A.ink : A.muted};${active === 'add' ? `background:${A.tint}` : ''}">Add a tool</a>
    <a href="#" class="ghost" style="color:${active === 'saved' ? A.ink : A.muted};${active === 'saved' ? `background:${A.tint}` : ''}">${svg(P.bookmark, 18)}Saved</a>
    ${signedIn ? `<button class="ghost" style="padding:0 6px;margin-left:6px;gap:8px">${avatar('N', 34)}${svg(P.chevron, 16)}</button>` : `<a href="#" class="btn btn-sm" style="text-decoration:none;color:${A.ink};margin-left:8px">Sign in</a>`}
  </nav>
</header>`;
const footer = () => `<footer style="border-top:2px solid ${A.ink};padding:28px 56px;display:flex;justify-content:space-between;align-items:center;font-size:14px;color:${A.muted}">${wordmark(20)}<div style="display:flex;gap:24px"><a href="#" style="color:${A.muted}">About</a><a href="#" style="color:${A.muted}">Guidelines</a><a href="#" style="color:${A.muted}">Contact</a><a href="#" style="color:${A.muted}">Privacy</a></div></footer>`;
const T = { splitwise: ['S', '#DCEBE3', '#1F5A48'], tricount: ['T', '#DFE6F2', '#2E4A7A'], settleup: ['U', '#F4E4D3', '#8A4E1C'], receiptly: ['R', '#F3E3E1', '#8A3A32'], krisp: ['K', '#E3ECF3', '#264E6E'], paper: ['P', '#F6E9D6', '#7A5216'], vocab: ['V', '#EDE4F3', '#5E3A80'], loops: ['L', '#EAE6F1', '#4E3F78'], ente: ['E', '#E8EFE4', '#3A5E2B'], spliddit: ['Sp', '#EDE4F3', '#5E3A80'], otter: ['O', '#E6EEF7', '#1F4E7A'], habit: ['H', '#F6E9D6', '#7A5216'], vault: ['B', '#E5E9F5', '#2A3A7A'] };
const tile = (k, s = 48) => { const [l, bg, fg] = T[k]; return `<span class="tile" style="width:${s}px;height:${s}px;background:${bg};color:${fg};font-size:${Math.round(s * 0.46)}px;border-radius:${Math.round(s * 0.25)}px">${l}</span>`; };
const stars = (n, s = 15) => `<span style="display:inline-flex;gap:2px">${[1, 2, 3, 4, 5].map(i => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${i <= n ? A.coral : 'none'}" stroke="${i <= n ? A.ink : A.rule}" stroke-width="2" stroke-linejoin="round">${P.star}</svg>`).join('')}</span>`;
const checkbox = (on) => `<span class="check${on ? ' on' : ''}">${on ? svg(P.check, 14, '#fff', 3) : ''}</span>`;
const like = (n, on = false, label = '') => `<button class="ghost like${on ? ' on' : ''}" style="height:34px;padding:0 9px" title="Helpful. Improves ranking for searches like yours.">${svg(P.heart, 17, 'currentColor', 2)}${n}${label ? ` ${label}` : ''}</button>`;
const meter = (fit, label) => `<div style="display:flex;flex-direction:column;gap:8px"><div style="font-size:13px;font-weight:600;color:${A.muted}">Fits what you asked <span style="color:${fit >= 90 ? A.ink : A.muted};margin-left:6px">${label}</span></div><div class="meter" style="--w:${fit}%"><div class="fill" style="--w:${fit}%"></div><div class="badge count" style="--w:${fit}%;--t:${fit}"></div></div></div>`;

const RESULTS = [
  { k: 'splitwise', name: 'Splitwise', fit: 92, label: 'strong match', summary: 'Splits shared expenses across a group and tells everyone who owes what.', why: 'Built specifically for splitting trip costs across a group, with a full Spanish interface and free core features.', sats: [[1, 'Free'], [1, 'Spanish, full interface'], [1, 'iOS and Android'], [0, 'No offline mode']], rating: '4.6', ratings: '812', likes: '218', saves: '1.2k' },
  { k: 'tricount', name: 'Tricount', fit: 86, label: 'strong match', summary: 'Group expense tracking without creating an account.', why: 'Made for group trips, works without an account, and has a Spanish interface. Handles multiple currencies well.', sats: [[1, 'Free'], [1, 'Spanish, full interface'], [1, 'iOS, Android, web'], [1, 'Partial offline']], rating: '4.4', ratings: '596', likes: '141', saves: '780' },
  { k: 'settleup', name: 'Settle Up', fit: 74, label: 'partial match', summary: 'Shared expenses with offline entry and later sync.', why: 'Covers group expense splitting including offline entry. Spanish support is partial: some screens are still English.', sats: [[1, 'Free tier'], [0, 'Spanish, partial'], [1, 'iOS and Android'], [1, 'Works offline']], rating: '4.2', ratings: '341', likes: '63', saves: '410' },
];
const QUERY = 'I need a free tool to split expenses between friends while travelling, in Spanish';

// =====================================================================================
// 1. Homepage
// =====================================================================================
const outCard = (x, delay, icon, label, fit) => `<g style="animation:drop 3s cubic-bezier(.34,1.56,.64,1) ${delay}s infinite"><rect x="${x + 3}" y="399" width="100" height="74" rx="12" fill="${A.ink}"/><rect x="${x}" y="396" width="100" height="74" rx="12" fill="${A.surface}" stroke="${A.ink}" stroke-width="3"/><g transform="translate(${x + 10}, 404) scale(.85)">${icon}</g><rect x="${x + 62}" y="408" width="28" height="12" rx="6" fill="${A.lime}" stroke="${A.ink}" stroke-width="2"/><text x="${x + 76}" y="417.5" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif" font-weight="800" font-size="9" fill="${A.ink}">${fit}</text><text x="${x + 10}" y="449" font-family="Bricolage Grotesque, sans-serif" font-weight="700" font-size="12" fill="${A.ink}">${label}</text><text x="${x + 10}" y="463" font-family="Onest, sans-serif" font-weight="500" font-size="10.5" fill="${A.muted}">fits your ask</text></g>`;
const icoCoins = `<circle cx="16" cy="16" r="14" fill="${A.tint}" stroke="${A.ink}" stroke-width="2.5"/><circle cx="13" cy="16" r="6" fill="${A.coral}" stroke="${A.ink}" stroke-width="2.5"/><circle cx="20" cy="16" r="6" fill="${A.lime}" stroke="${A.ink}" stroke-width="2.5"/>`;
const icoReceipt = `<circle cx="16" cy="16" r="14" fill="${A.tint}" stroke="${A.ink}" stroke-width="2.5"/><path d="M10 8h12v16l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z" fill="${A.surface}" stroke="${A.ink}" stroke-width="2.2" stroke-linejoin="round"/><path d="M13 13h6M13 17h4" stroke="${A.ink}" stroke-width="2"/>`;
const icoMap = `<circle cx="16" cy="16" r="14" fill="${A.tint}" stroke="${A.ink}" stroke-width="2.5"/><path d="M16 25s-6-5.4-6-10a6 6 0 0 1 12 0c0 4.6-6 10-6 10z" fill="${A.violet}" stroke="${A.ink}" stroke-width="2.3"/><circle cx="16" cy="15" r="2.2" fill="${A.surface}"/>`;
const contraption = `<svg viewBox="40 0 560 480" width="560" height="480" style="overflow:visible" aria-hidden="true">
  <defs><clipPath id="win"><rect x="150" y="150" width="220" height="130" rx="18"/></clipPath></defs>
  <rect x="96" y="126" width="330" height="240" rx="28" fill="${A.ink}"/>
  <rect x="88" y="118" width="330" height="240" rx="28" fill="${A.tint}" stroke="${A.ink}" stroke-width="3"/>
  <path d="M170 118 L140 48 L370 48 L340 118 Z" fill="${A.surface}" stroke="${A.ink}" stroke-width="3" stroke-linejoin="round"/>
  <g style="transform-origin:255px 40px;animation:bob 2.6s ease-in-out infinite">
    <rect x="175" y="0" width="160" height="66" rx="10" fill="${A.surface}" stroke="${A.ink}" stroke-width="3"/>
    <text x="190" y="26" font-family="Onest, sans-serif" font-size="13" font-weight="500" fill="${A.ink}">split costs with</text><text x="190" y="44" font-family="Onest, sans-serif" font-size="13" font-weight="500" fill="${A.ink}">friends, free, Spanish</text><rect x="190" y="52" width="40" height="5" rx="2.5" fill="${A.coral}"/>
  </g>
  <rect x="150" y="150" width="220" height="130" rx="18" fill="${A.surface}" stroke="${A.ink}" stroke-width="3"/>
  <g clip-path="url(#win)"><g style="transform-origin:260px 215px;animation:spin 6s linear infinite"><circle cx="260" cy="215" r="52" fill="${A.violet}" stroke="${A.ink}" stroke-width="3"/><path d="M260 163v104M208 215h104M223 178l74 74M297 178l-74 74" stroke="${A.ink}" stroke-width="3"/><circle cx="260" cy="215" r="14" fill="${A.lime}" stroke="${A.ink}" stroke-width="3"/></g></g>
  <circle cx="118" cy="330" r="16" fill="${A.coral}" stroke="${A.ink}" stroke-width="3"/>
  <g style="transform-origin:440px 190px;animation:spin 3s linear infinite reverse"><circle cx="440" cy="190" r="22" fill="${A.lime}" stroke="${A.ink}" stroke-width="3"/><path d="M440 168v44M418 190h44" stroke="${A.ink}" stroke-width="3"/></g>
  <rect x="418" y="200" width="6" height="90" fill="${A.ink}"/>
  <path d="M300 358 L400 358 L440 400 L340 400 Z" fill="${A.surface}" stroke="${A.ink}" stroke-width="3" stroke-linejoin="round"/>
  ${outCard(292, 0, icoCoins, 'Bill splitter', 92)}
  ${outCard(398, 1, icoReceipt, 'Receipt scanner', 86)}
  ${outCard(504, 2, icoMap, 'Trip budget', 74)}
</svg>`;
const TOP = [
  { k: 'splitwise', name: 'Splitwise', s: 'Splits shared expenses across a group.', likes: '2.1k', saves: '6.4k', cat: 'Money' },
  { k: 'krisp', name: 'Quiet Room', s: 'Removes background noise from recordings.', likes: '1.8k', saves: '4.9k', cat: 'Audio' },
  { k: 'ente', name: 'Ente', s: 'Photo backup without Google or Apple.', likes: '1.6k', saves: '4.2k', cat: 'Photos' },
  { k: 'paper', name: 'PaperTrail', s: 'Sign a PDF without paying.', likes: '1.3k', saves: '3.8k', cat: 'Documents' },
  { k: 'vault', name: 'Bitwarden', s: 'Password manager you can self-host.', likes: '1.2k', saves: '3.5k', cat: 'Privacy' },
  { k: 'otter', name: 'Otter Notes', s: 'Turns a meeting recording into notes.', likes: '980', saves: '2.9k', cat: 'Writing' },
  { k: 'loops', name: 'Loops', s: 'One-tap habit tracking with streaks.', likes: '870', saves: '2.4k', cat: 'Habits' },
  { k: 'tricount', name: 'Tricount', s: 'Group expenses without an account.', likes: '810', saves: '2.2k', cat: 'Money' },
  { k: 'vocab', name: 'Vocab', s: 'Spaced-repetition vocabulary in any language.', likes: '640', saves: '1.9k', cat: 'Study' },
  { k: 'receiptly', name: 'Receiptly', s: 'Splits a photographed receipt by line.', likes: '520', saves: '1.4k', cat: 'Money' },
];
const topRow = (t, i, left, first) => `<a href="#" style="display:grid;grid-template-columns:34px 44px minmax(0, 1fr) auto;gap:14px;align-items:center;padding:14px 22px;color:${A.ink};text-decoration:none;${first ? '' : `border-top:2px solid ${A.rule};`}${left ? `border-right:2px solid ${A.rule};` : ''}transition:background 140ms" onfocus="">
  <span class="disp tab" style="font-size:22px;color:${i < 3 ? A.coral : A.faint};font-weight:800">${i + 1}</span>${tile(t.k, 44)}
  <span><span class="disp" style="font-size:18px;font-weight:700;display:block">${t.name}</span><span style="font-size:13.5px;color:${A.muted}">${t.s}</span></span>
  <span class="tab" style="display:flex;gap:12px;font-size:13px;color:${A.muted};white-space:nowrap"><span style="display:inline-flex;align-items:center;gap:4px">${svg(P.heart, 14, A.coral, 2.25)}${t.likes}</span><span style="display:inline-flex;align-items:center;gap:4px">${svg(P.bookmark, 14, A.violet, 2.25)}${t.saves}</span></span>
</a>`;
files['Main.dc.html'] = page(`<div style="min-height:900px;background:${A.bg};position:relative;overflow:hidden">
<div style="position:absolute;top:-120px;right:-80px;width:720px;height:720px;border-radius:50%;background:radial-gradient(circle, rgba(110,75,246,.14), transparent 62%);pointer-events:none"></div>
${header()}
<main style="position:relative">
  <section style="max-width:1280px;margin:0 auto;padding:72px 56px 56px;display:grid;grid-template-columns:minmax(0, 56fr) minmax(0, 44fr);gap:40px;align-items:center">
    <div style="display:flex;flex-direction:column;gap:30px">
      <h1 class="disp rise" style="font-size:78px;margin:0;max-width:640px">Say what’s bugging you. We’ll <span class="hl" style="color:#fff;padding:0 6px">find the tool.</span></h1>
      <p class="rise" style="margin:0;font-size:19px;color:${A.muted};max-width:520px;line-height:1.5;animation-delay:120ms">No app names, no categories. Describe the problem in a sentence or a few and get the tools that actually fit, with the reasons.</p>
      <div class="slab rise" style="position:relative;padding:24px 88px 24px 26px;min-height:112px;animation-delay:200ms">
        <div style="font-size:19px;line-height:1.5;color:${A.muted}">Free way to split expenses with friends on a trip, in Spanish<span style="display:inline-block;width:2px;height:22px;background:${A.coral};vertical-align:-4px;margin-left:2px;animation:caret 1s steps(2) infinite"></span></div>
        <button class="btn btn-coral" aria-label="Find tools" style="position:absolute;right:16px;bottom:16px;width:60px;height:60px;padding:0;border-radius:16px">${svg(P.arrowUp, 26, '#fff', 2.25)}</button>
      </div>
      <div class="rise" style="display:flex;flex-wrap:wrap;gap:12px;animation-delay:300ms">
        <button class="pill">Scan receipts without an account</button>
        <button class="pill">Track habits offline</button>
        <button class="pill">Transcribe interviews in French</button>
        <button class="pill">Back up photos without Google</button>
      </div>
    </div>
    <div class="rise" style="display:flex;justify-content:center;animation-delay:260ms">${contraption}</div>
  </section>

  <section style="max-width:1280px;margin:0 auto;padding:40px 56px 72px">
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:26px">
      <h2 class="disp" style="font-size:38px;margin:0;font-weight:700">Found this week</h2>
      <a href="#" style="font-weight:600">See all problems people solved</a>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:28px">
      ${[
        ['“Remove background noise from a voice recording”', 'Quiet Room', 'krisp', 'Free, works offline, macOS and Windows', '-1.2deg', '1,204'],
        ['“Sign a PDF on my phone without paying”', 'PaperTrail', 'paper', 'Free, no account, iOS and Android', '1deg', '860'],
        ['“Learn Spanish vocabulary with spaced repetition”', 'Vocab', 'vocab', 'Free, web and mobile', '-0.6deg', '412'],
      ].map(([q, n, k, meta, rot, ppl]) => `<a href="#" class="card hov" style="padding:26px;display:flex;flex-direction:column;gap:18px;color:${A.ink};text-decoration:none">
        <div class="disp" style="font-size:24px;font-weight:700;line-height:1.15;letter-spacing:-0.01em">${q}</div>
        <div style="display:flex;align-items:center;gap:14px;margin-top:auto">${tile(k, 48)}<div><div style="font-weight:600;font-size:17px">${n}</div><div style="font-size:14px;color:${A.muted}">${meta}</div></div></div>
        <div style="font-size:13.5px;color:${A.muted};display:flex;align-items:center;gap:6px">${svg(P.heart, 15, A.coral, 2)}${ppl} people found it useful</div>
      </a>`).join('')}
    </div>
  </section>

  <section style="max-width:1280px;margin:0 auto;padding:0 56px 80px">
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:22px">
      <h2 class="disp" style="font-size:38px;margin:0;font-weight:700">Top tools this month</h2>
      <a href="#" style="font-weight:600">See all top tools</a>
    </div>
    <div class="panel" style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));overflow:hidden">
      ${TOP.slice(0, 6).map((t, i) => topRow(t, i, i % 2 === 0, i < 2)).join('')}
    </div>
  </section>

  <section style="max-width:1280px;margin:0 auto;padding:0 56px 88px;display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:28px">
    ${[
      ['Write it like you’d say it', 'Constraints count. “Free”, “offline”, “in Spanish” change the answer. Any language works.', A.coral],
      ['We match on problems, not names', 'Every tool is indexed by the jobs it actually does, in plain language.', A.violet],
      ['See why, not just what', 'Each result shows how well it fits and which of your constraints it misses.', A.lime],
    ].map(([h, b, c]) => `<div style="display:flex;gap:16px;align-items:flex-start"><span style="width:22px;height:22px;border-radius:50%;background:${c};border:2px solid ${A.ink};flex:none;margin-top:4px"></span><div><div class="disp" style="font-size:22px;font-weight:700;letter-spacing:-0.01em;margin-bottom:6px">${h}</div><div style="color:${A.muted};line-height:1.5">${b}</div></div></div>`).join('')}
  </section>
</main>
${footer()}
</div>`);

// =====================================================================================
// 2. Results — a conversation you can continue
// =====================================================================================
const resultCard = (r, big, i, rot = true) => `<article class="card hov rise" style="padding:${big ? '30px 32px' : '24px 26px'};display:flex;flex-direction:column;gap:${big ? 20 : 16}px;animation-delay:${i * 90 + 100}ms;${big ? 'grid-column:span 2;' : ''}">
  ${meter(r.fit, r.label)}
  <div style="display:flex;gap:16px;align-items:center">
    ${tile(r.k, big ? 60 : 48)}
    <div style="flex:1;min-width:0"><a href="#" class="disp" style="font-size:${big ? 34 : 26}px;font-weight:800;color:${A.ink};text-decoration:none">${r.name}</a><div style="color:${A.muted};font-size:${big ? 16 : 15}px">${r.summary}</div></div>
  </div>
  <div class="why" style="font-size:${big ? 17 : 15}px"><b>Why it matches.</b> ${r.why}</div>
  <div style="display:flex;flex-wrap:wrap;gap:8px">${r.sats.map(([ok, s]) => `<span class="sat${ok ? '' : ' unmet'}">${svg(ok ? P.check : P.dash, 14, 'currentColor', 2.25)}${s}</span>`).join('')}</div>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:auto;padding-top:4px">
    <div class="tab" style="display:flex;align-items:center;gap:10px;font-size:14px;color:${A.muted}"><span style="display:flex;align-items:center;gap:5px;color:${A.ink}">${svg(P.star, 15, A.coral, 2)}<strong style="font-weight:600">${r.rating}</strong> <span style="color:${A.muted}">(${r.ratings})</span></span>${like(r.likes)}</div>
    <div style="display:flex;gap:8px"><button class="btn btn-sm">${svg(P.bookmark, 16)}Save</button>${big ? `<a href="#" class="btn btn-sm btn-coral" style="text-decoration:none;color:#fff">Open ${r.name} ${svg(P.external, 16, '#fff')}</a>` : ''}</div>
  </div>
</article>`;
const userBubble = (text, extra = '') => `<div style="display:flex;justify-content:flex-end;${extra}"><div style="max-width:720px;background:${A.tint};border:2px solid ${A.ink};border-radius:20px 20px 6px 20px;padding:16px 22px;font-size:18px;line-height:1.5;box-shadow:4px 4px 0 ${A.violet}">${text}</div></div>`;
files['Results.dc.html'] = page(`<div style="min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header()}
<main style="max-width:1280px;margin:0 auto;padding:8px 56px 40px;display:flex;flex-direction:column;gap:26px;width:100%;flex:1">
  ${userBubble(QUERY)}
  <div style="display:flex;gap:16px;align-items:flex-start">
    ${mark(40)}
    <div style="flex:1;display:flex;flex-direction:column;gap:22px;min-width:0">
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding-top:6px">
        <span style="font-weight:600;color:${A.muted};margin-right:6px">Here’s what I understood</span>
        <button class="pill sm on">Free ${svg(P.x, 14, '#fff', 2.25)}</button><button class="pill sm on">Spanish ${svg(P.x, 14, '#fff', 2.25)}</button><button class="pill sm soft" title="Guessed from “while travelling”. Tap to turn it off.">Mobile ${svg(P.x, 14, 'currentColor', 2.25)}</button><button class="pill sm soft">Trips ${svg(P.x, 14, 'currentColor', 2.25)}</button><button class="pill sm flat">${svg(P.plus, 16, 'currentColor', 2.25)}Add a constraint</button>
        <button class="pill sm flat" style="margin-left:auto">${svg(P.filter, 16)}Filters</button>
      </div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px">
        <div><span class="disp" style="font-size:34px;font-weight:800">3 tools fit.</span> <span style="font-size:17px;color:${A.muted}">3 more solve this but not in Spanish. <a href="#">Show them anyway</a></span></div>
        <div style="font-size:15px;color:${A.muted}">Sorted by <strong style="color:${A.ink};font-weight:600">best fit</strong></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:28px;padding:6px">
        ${resultCard(RESULTS[0], true, 0)}${resultCard(RESULTS[1], false, 1)}${resultCard(RESULTS[2], false, 2)}
        <div class="slab rise" style="grid-column:span 2;align-self:start;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:24px 28px;box-shadow:6px 6px 0 ${A.lime};animation-delay:500ms">
          <div><div class="disp" style="font-size:26px;font-weight:800">Keep your results.</div><div style="color:${A.muted};margin-top:4px">Create a free account to save tools you like and pick up where you left off. Takes about five seconds.</div></div>
          <div style="display:flex;gap:10px;align-items:center"><button class="ghost">Not now</button><button class="btn btn-coral">Create free account</button></div>
        </div>
      </div>
      <div style="font-size:14px;color:${A.muted}">Not quite it? Tell me what to change below. Search stays free, no account needed.</div>
    </div>
  </div>
</main>
<div style="position:sticky;bottom:0;padding:16px 56px 28px;background:linear-gradient(to top, ${A.bg} 70%, transparent)">
  <div class="slab" style="max-width:1168px;margin:0 auto;position:relative;padding:18px 84px 18px 24px;min-height:72px;display:flex;align-items:center">
    <div style="font-size:17px;color:${A.faint}">Add more, or change something. e.g. “it also needs to work offline” or “forget Spanish, English is fine”</div>
    <button class="btn btn-coral" aria-label="Send" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);width:52px;height:52px;padding:0;border-radius:14px">${svg(P.arrowUp, 24, '#fff', 2.25)}</button>
  </div>
</div>
</div>`);

// =====================================================================================
// 3. Tool detail
// =====================================================================================
const shot = (cap) => `<div style="width:220px;flex:none;display:flex;flex-direction:column;gap:8px"><div style="height:352px;border-radius:18px;background:${A.sunk};border:2px solid ${A.ink};display:flex;align-items:center;justify-content:center">${svg(P.image, 30, A.faint)}</div><div style="font-size:13.5px;color:${A.muted};font-weight:500">${cap}</div></div>`;
const bar = (label, pct) => `<div style="display:flex;align-items:center;gap:10px;font-size:13px"><span class="tab" style="width:14px;color:${A.muted};font-weight:600">${label}</span><div style="flex:1;height:12px;border-radius:999px;background:#EFEBE2;border:2px solid ${A.ink};overflow:hidden"><div style="width:${pct}%;height:100%;background:${A.violet}"></div></div><span class="tab" style="width:34px;color:${A.muted};text-align:right">${pct}%</span></div>`;
const review = ({ name, level, date, r, used, body, helpful, initial, bg, fg }) => `<div style="padding:24px 0;border-top:2px solid ${A.rule};display:flex;flex-direction:column;gap:10px">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px"><div style="display:flex;align-items:center;gap:12px">${avatar(initial, 38, bg, fg)}<div><div style="font-weight:600;font-size:15px">${name} <span class="pillstat" style="background:${A.sunk};color:${A.muted};margin-left:4px;height:22px;font-size:11px">${level}</span></div><div style="font-size:12.5px;color:${A.faint}">${date}</div></div></div>${stars(r)}</div>
  <div style="font-size:14px;color:${A.muted}">Used it for: <span style="color:${A.ink};font-weight:500">${used}</span></div>
  <div style="line-height:1.6">${body}</div>
  <div style="display:flex;gap:6px;margin-top:2px"><button class="btn btn-xs">Helpful (${helpful})</button><button class="ghost">Not helpful</button></div>
</div>`;
const li = (txt, ok) => `<li style="display:flex;gap:10px;align-items:flex-start;line-height:1.5">${svg(ok ? P.check : P.dash, 20, ok ? A.violet : A.faint, 2.5, 'margin-top:2px')}<span>${txt}</span></li>`;
files['ToolDetail.dc.html'] = page(`<div style="min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header({ signedIn: true })}
<div style="max-width:1280px;margin:0 auto;padding:4px 56px 0;width:100%;font-size:14px;color:${A.muted};display:flex;gap:8px;align-items:center"><a href="#" style="color:${A.muted}">Results</a>${svg(P.chevronR, 14, A.faint)}<span>Splitwise</span></div>
<main style="max-width:1280px;margin:0 auto;padding:24px 56px 96px;width:100%;display:grid;grid-template-columns:minmax(0, 1fr) 340px;gap:56px;align-items:start">
  <div style="display:flex;flex-direction:column;gap:48px">
    <section style="display:flex;flex-direction:column;gap:18px">
      <div style="display:flex;gap:22px;align-items:center">
        ${tile('splitwise', 84)}
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;gap:12px"><h1 class="disp" style="font-size:52px;margin:0">Splitwise</h1><span class="pillstat" style="background:${A.sunk};border:2px solid ${A.rule};color:${A.muted};height:30px;gap:6px" title="We added this one at launch. Nobody from Splitwise looks after it yet.">Unclaimed</span></div>
          <div style="font-size:19px;color:${A.muted}">Splits shared expenses across a group and tells everyone who owes what.</div>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${['Free plan', 'iOS, Android, web', 'Spanish, full interface', 'Account required'].map(x => `<span class="tag">${x}</span>`).join('')}</div>
      <div class="tab" style="display:flex;align-items:center;gap:12px;font-size:15px">${stars(5, 18)}<strong style="font-weight:700;font-size:18px">4.6</strong><span style="color:${A.muted}">812 ratings</span>${like('218', true, 'found it useful')}<a href="#" style="font-weight:600">Write a review</a></div>
    </section>
    <section><div style="display:flex;gap:18px;overflow:hidden">${shot('Group overview')}${shot('Adding an expense')}${shot('Who owes whom')}${shot('Settling up in euros')}</div></section>
    <section style="display:flex;flex-direction:column;gap:8px">
      <h2 class="h2" style="margin-bottom:10px">Solves these problems</h2>
      ${[['Splitting a holiday’s costs across a group of friends', '1,240'], ['Tracking who paid for what in a shared flat', '380'], ['Settling up in a currency that isn’t your own', '212'], ['Keeping a running tab with a partner without arguing about it', '97']].map(([q, n]) => `<a href="#" class="panel" style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 20px;color:${A.ink};text-decoration:none"><span class="disp" style="font-size:20px;font-weight:700">${q}</span><span class="tab" style="font-size:13px;color:${A.muted};white-space:nowrap;font-weight:500;display:inline-flex;align-items:center;gap:6px">matched ${n} searches ${svg(P.arrow, 14, A.violet, 2.25)}</span></a>`).join('')}
    </section>
    <section style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:32px">
      <div class="panel" style="padding:24px;background:${A.tint};border-color:${A.violet}"><h2 class="h3" style="margin-bottom:14px">Good for</h2><ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px">${li('Groups of 3 to 15', 1)}${li('Multi-currency trips', 1)}${li('People who want a phone app, not a spreadsheet', 1)}</ul></div>
      <div class="panel" style="padding:24px;border-color:${A.rule}"><h2 class="h3" style="margin-bottom:14px">Not good for</h2><ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px">${li('Offline use. It needs a connection to sync', 0)}${li('Anyone unwilling to create an account', 0)}${li('Itemised receipt scanning (paid tier only)', 0)}</ul></div>
    </section>
    <section style="display:flex;flex-direction:column;gap:14px">
      <h2 class="h2">Pricing</h2>
      <div class="panel" style="overflow:hidden">
        <div style="display:grid;grid-template-columns:120px 110px minmax(0, 1fr) minmax(0, 1fr);gap:16px;padding:12px 22px;background:${A.sunk};font-size:12.5px;font-weight:700;color:${A.muted};border-bottom:2px solid ${A.ink}"><span>Plan</span><span>Price</span><span>What you get</span><span>The catch</span></div>
        ${[['Free', '$0', 'Unlimited groups and expenses', 'Ads in the app; receipt scanning locked'], ['Pro', '$4.99 / mo', 'Receipt scanning, currency conversion, charts', 'Billed yearly on iOS'], ['Pro (EU)', '€4.49 / mo', 'Same as Pro', 'Price varies by country']].map((r, i) => `<div class="tab" style="display:grid;grid-template-columns:120px 110px minmax(0, 1fr) minmax(0, 1fr);gap:16px;padding:14px 22px;${i ? `border-top:1.5px solid ${A.rule}` : ''};font-size:15px"><strong style="font-weight:700">${r[0]}</strong><span>${r[1]}</span><span>${r[2]}</span><span style="color:${A.muted}">${r[3]}</span></div>`).join('')}
      </div>
    </section>
    <section style="display:flex;flex-direction:column;gap:14px">
      <h2 class="h2">Platforms and languages</h2>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${['iOS', 'Android', 'Web'].map(x => `<span class="tag">${x}</span>`).join('')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px"><span class="sat">${svg(P.check, 14, 'currentColor', 2.25)}English</span><span class="sat">${svg(P.check, 14, 'currentColor', 2.25)}Spanish, full interface</span><span class="sat">${svg(P.check, 14, 'currentColor', 2.25)}French</span><span class="sat unmet">${svg(P.dash, 14, 'currentColor', 2.25)}Portuguese, partial</span><span class="tag">+ 9 more</span></div>
    </section>
    <section style="display:flex;flex-direction:column;gap:18px">
      <h2 class="h2">Ratings</h2>
      <div style="display:grid;grid-template-columns:160px minmax(0, 1fr) minmax(0, 1fr);gap:40px;align-items:start">
        <div><div class="disp tab" style="font-size:72px">4.6</div>${stars(5, 18)}<div style="font-size:13.5px;color:${A.muted};margin-top:6px">812 ratings</div></div>
        <div style="display:flex;flex-direction:column;gap:8px">${bar('5', 71)}${bar('4', 19)}${bar('3', 6)}${bar('2', 2)}${bar('1', 2)}</div>
        <div class="tab" style="display:flex;flex-direction:column;gap:8px;font-size:15px">${[['Solved my problem', '4.7'], ['Easy to start', '4.4'], ['Worth the price', '4.1']].map(([k, v]) => `<div style="display:flex;justify-content:space-between;border-bottom:1.5px solid ${A.rule};padding-bottom:6px"><span style="color:${A.muted}">${k}</span><strong style="font-weight:700">${v}</strong></div>`).join('')}<div style="font-size:13.5px;color:${A.muted};margin-top:4px">Most recommended for: trips (68%), shared flats (21%)</div></div>
      </div>
    </section>
    <section style="display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><h2 class="h2">Reviews</h2><div style="display:flex;gap:6px"><button class="pill sm on">Most helpful</button><button class="pill sm flat">Newest</button><button class="pill sm flat">Lowest rated</button></div></div>
      ${review({ name: 'Noa Ben-Ami', level: 'Added 4 tools', date: '2 Aug 2026', r: 5, used: 'a two-week trip in Greece with six people', body: 'The Spanish interface is genuinely complete, even the settle-up flow. What surprised me: it handled euros and pesos in the same group without anyone doing maths. The ads on the free plan are one banner, not the interruption I feared.', helpful: 14, initial: 'N', bg: '#DCEBE3', fg: '#1F5A48' })}
      ${review({ name: 'Marcus Oyelaran', level: 'Added 12 tools', date: '19 Jul 2026', r: 4, used: 'a shared flat with three people, ongoing', body: 'Fine for recurring bills, but the free tier stops you scanning receipts, so itemised groceries end up typed in by hand. If your flatmates are the receipt-photo type, look at Receiptly.', helpful: 9, initial: 'M', bg: '#DFE6F2', fg: '#2E4A7A' })}
      <div style="border-top:2px solid ${A.rule};padding-top:16px"><a href="#" style="font-weight:600">Show all 212 reviews</a></div>
    </section>
    <section style="display:flex;flex-direction:column;gap:14px">
      <h2 class="h2">Alternatives</h2>
      <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:24px">
        ${[['tricount', 'Tricount', 'No account needed, weaker currency handling.', '-0.8deg'], ['settleup', 'Settle Up', 'Works offline; Spanish is partial.', '0.7deg'], ['receiptly', 'Receiptly', 'Receipt scanning is the free part, not the paid one.', '-0.5deg']].map(([k, n, d, rot]) => `<a href="#" class="card hov" style="padding:20px;display:flex;flex-direction:column;gap:12px;color:${A.ink};text-decoration:none"><div style="display:flex;align-items:center;gap:12px">${tile(k, 40)}<span class="disp" style="font-size:20px;font-weight:700">${n}</span></div><div style="font-size:14.5px;color:${A.muted};line-height:1.5">${d}</div></a>`).join('')}
      </div>
    </section>
    <div class="panel" style="padding:22px 26px;display:flex;align-items:center;justify-content:space-between;gap:24px;background:${A.tint};border-color:${A.violet}">
      <div style="display:flex;gap:16px;align-items:center">${svg(P.shield, 32, A.violet, 2)}<div><div class="disp" style="font-size:22px;font-weight:700">Do you work on Splitwise?</div><div style="color:${A.muted};font-size:14.5px;margin-top:2px">This is one of the tools we added at launch, so it’s free to claim. One click, nothing to verify.</div></div></div>
      <a href="#" class="btn btn-sm btn-violet" style="text-decoration:none;color:#fff">Claim this tool</a>
    </div>
    <div style="border-top:2px solid ${A.rule};padding-top:18px;font-size:14px;color:${A.muted};display:flex;flex-wrap:wrap;gap:6px 20px;align-items:center"><span style="display:inline-flex;align-items:center;gap:8px">Added by <strong style="color:${A.ink};font-weight:600">Foundit</strong> when we launched</span><span>3 Feb 2026</span><a href="#" style="color:${A.muted}">Report this listing</a></div>
  </div>
  <aside style="position:sticky;top:24px;display:flex;flex-direction:column;gap:14px">
    <div class="slab" style="padding:20px;display:flex;flex-direction:column;gap:12px;box-shadow:6px 6px 0 ${A.ink}">
      ${meter(92, 'strong match for your search')}
      <a href="#" class="btn btn-coral" style="height:56px;font-size:17px;text-decoration:none;color:#fff;margin-top:6px">Open Splitwise ${svg(P.external, 18, '#fff')}</a>
      <div style="display:flex;gap:8px"><button class="btn btn-sm" style="flex:1;background:${A.tint}"><svg width="18" height="18" viewBox="0 0 24 24" fill="${A.violet}" stroke="${A.ink}" stroke-width="2">${P.bookmark}</svg>Saved in Trip planning ${svg(P.chevron, 14)}</button><button class="btn btn-sm" style="width:46px;padding:0" aria-label="Share">${svg(P.share, 18)}</button></div>
    </div>
    <div class="panel" style="padding:20px"><dl class="facts">${[['Maker', 'Splitwise, Inc.'], ['Added by', 'Foundit at launch'], ['First added', '3 Feb 2026'], ['Last updated', '12 Aug 2026']].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div>
    <div style="font-size:13.5px;color:${A.muted};line-height:1.5;padding:0 4px">Foundit takes no referral fees or paid placement. Rankings can’t be bought.</div>
  </aside>
</main>
${footer()}
</div>`);

// =====================================================================================
// 4. Submit a tool — step 3
// =====================================================================================
const steps = (cur) => ['URL', 'Details', 'Problems', 'Constraints', 'Preview'].map((s, i) => `<div class="step ${i < cur ? 'done' : i === cur ? 'now' : 'todo'}"><span class="dot">${i < cur ? svg(P.check, 14, A.ink, 3) : i + 1}</span>${s}</div>${i < 4 ? `<div style="width:48px;height:2px;background:${i < cur ? A.ink : A.rule};margin:0 12px"></div>` : ''}`).join('');
const problemInput = (n, val, ghost) => `<div style="display:flex;gap:16px;align-items:flex-start"><span class="disp tab" style="font-size:26px;color:${A.faint};width:26px;padding-top:12px;font-weight:700">${n}</span><div class="field area" style="flex:1;font-size:17px;${val ? '' : `border-color:${A.rule};`}"><span class="${val ? '' : 'ph'}">${val || ghost}</span></div></div>`;
files['SubmitTool.dc.html'] = page(`<div style="min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header({ active: 'add', signedIn: true })}
<div style="padding:8px 56px 26px;display:grid;grid-template-columns:200px minmax(0, 1fr) 220px;align-items:center">
  <a href="#" class="ghost" style="justify-self:start">${svg(P.back, 16)}Back</a>
  <div style="display:flex;align-items:center;justify-content:center">${steps(2)}</div>
  <div style="text-align:right;font-size:13.5px;color:${A.muted};display:flex;justify-content:flex-end;align-items:center;gap:6px;font-weight:500">${svg(P.check, 14, A.violet, 2.5)}Draft saved, continue anytime</div>
</div>
<main style="max-width:1280px;margin:0 auto;padding:36px 56px 80px;width:100%;display:grid;grid-template-columns:minmax(0, 680px) 360px;gap:64px;justify-content:center">
  <div style="display:flex;flex-direction:column;gap:28px">
    <div><div style="font-size:14px;font-weight:600;color:${A.muted};margin-bottom:10px">Step 3 of 5 · Receiptly</div><h1 class="disp" style="font-size:46px;margin:0 0 12px">What problems does this solve?</h1><p style="margin:0;font-size:17px;color:${A.muted};line-height:1.55">Write like someone describing their situation, in a sentence or a few. This is what people actually search. The first is required; two more make you findable from more angles.</p></div>
    <div style="display:flex;flex-direction:column;gap:14px">
      ${problemInput(1, 'Splitting a restaurant bill when everyone ordered different things and nobody wants to do the maths', '')}
      ${problemInput(2, 'Keeping track of shared groceries in a flat by photographing the receipt', '')}
      ${problemInput(3, '', 'e.g. Settling up in a currency that isn’t your own')}
    </div>
    <div style="display:flex;align-items:flex-start;gap:10px;font-size:14.5px;color:${A.muted};padding:14px 16px;background:${A.sunk};border-radius:14px;line-height:1.5">${svg(P.info, 18, A.faint, 2, 'margin-top:1px')}<span>Describe the situation, not the feature. “Splitting a bill unevenly” gets found. “Smart itemised splitting engine” doesn’t.</span></div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px"><button class="ghost" style="height:44px">Back</button><button class="btn btn-coral" style="padding:0 26px">Continue to constraints ${svg(P.arrow, 18, '#fff', 2.25)}</button></div>
  </div>
  <aside class="slab" style="padding:24px;display:flex;flex-direction:column;gap:14px;align-self:start;box-shadow:6px 6px 0 ${A.lime}">
    <div class="h3">People searching for this would find you</div>
    <div style="font-size:14px;color:${A.muted};line-height:1.5">Real searches from the last 30 days that would now match Receiptly.</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${[['“how to split a restaurant bill when we all ordered different stuff”', 'Strong match'], ['“app that reads a receipt and divides it between 4 people”', 'Strong match'], ['“track flat groceries without a spreadsheet”', 'Good match']].map(([q, m]) => `<div style="padding:12px 14px;border-radius:14px;background:${A.tint}"><div class="disp" style="font-size:16px;font-weight:700;line-height:1.35">${q}</div><div style="font-size:12.5px;color:${A.violet};font-weight:700;margin-top:6px;display:flex;align-items:center;gap:5px">${svg(P.check, 12, 'currentColor', 3)}${m}</div></div>`).join('')}
    </div>
    <div style="font-size:13.5px;color:${A.muted};line-height:1.5;border-top:2px solid ${A.rule};padding-top:12px">Updates as you type. Add a third statement to reach “multi-currency” searches (41 last month).</div>
  </aside>
</main>
</div>`);

// =====================================================================================
// 5. Review queue
// =====================================================================================
const qItem = ({ name, who, lvl, age, flags = [], active = false, claimed = '' }) => `<div style="padding:16px 18px;border-bottom:2px solid ${A.rule};background:${active ? A.surface : 'transparent'};display:flex;flex-direction:column;gap:6px;${active ? `box-shadow:inset 4px 0 0 ${A.coral};` : ''}">
  <div style="display:flex;justify-content:space-between;align-items:baseline"><span class="disp" style="font-weight:700;font-size:18px">${name}</span><span class="tab" style="font-size:12.5px;color:${A.faint};font-weight:500">${age}</span></div>
  <div style="font-size:13.5px;color:${A.muted}">${who} <span class="pillstat" style="background:${A.sunk};color:${A.muted};height:20px;font-size:11px;padding:0 7px">${lvl}</span></div>
  ${flags.length ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:2px">${flags.map(([f, warn]) => `<span class="pillstat" style="height:22px;font-size:11.5px;background:${warn ? A.amber : A.sunk};color:${warn ? A.amberInk : A.ink}">${f}</span>`).join('')}</div>` : ''}
  ${claimed ? `<div style="font-size:12.5px;color:${A.faint};display:flex;align-items:center;gap:5px">${svg(P.clock, 12)}${claimed}</div>` : ''}
</div>`;
const checkItem = (txt, on) => `<label style="display:flex;gap:12px;align-items:flex-start;font-size:15px;line-height:1.45">${checkbox(on)}<span>${txt}</span></label>`;
files['ReviewQueue.dc.html'] = page(`<div style="min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header({ signedIn: true })}
<div style="flex:1;display:grid;grid-template-columns:230px 330px minmax(0, 1fr);min-height:0;border-top:2px solid ${A.ink}">
  <nav style="border-right:2px solid ${A.ink};padding:24px 16px;display:flex;flex-direction:column;gap:6px">
    <div class="disp" style="font-size:22px;font-weight:700;padding:0 10px 12px">Review queue</div>
    ${[['New submissions', 12, true], ['Edit suggestions', 7], ['Reported listings', 2], ['Duplicate candidates', 4], ['My claimed items', 1]].map(([l, n, on]) => `<a href="#" style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:12px;font-size:15px;color:${A.ink};background:${on ? A.tint : 'transparent'};font-weight:${on ? 700 : 500};text-decoration:none;${on ? `border:2px solid ${A.ink}` : 'border:2px solid transparent'}">${l}<span class="tab" style="font-size:13px;color:${A.muted}">${n}</span></a>`).join('')}
    <div style="margin-top:auto;font-size:13px;color:${A.faint};padding:0 10px;line-height:1.5">Signed in as @marcus, Reviewer</div>
  </nav>
  <div style="border-right:2px solid ${A.ink};overflow:hidden;display:flex;flex-direction:column;background:${A.sunk}">
    <div style="padding:14px 18px;border-bottom:2px solid ${A.rule};display:flex;justify-content:space-between;align-items:center;font-size:14px"><span style="color:${A.muted};font-weight:500">12 waiting, oldest 2d</span><span style="display:flex;align-items:center;gap:4px;font-weight:600">Oldest first ${svg(P.chevron, 14)}</span></div>
    ${qItem({ name: 'Receiptly', who: '@priya', lvl: 'Maker claim', age: '4h', flags: [['Possible duplicate', true], ['First submission', false]], active: true, claimed: 'Being reviewed by you, 26 min left' })}
    ${qItem({ name: 'Quiet Room', who: '@marcus_b', lvl: 'Contributor', age: '7h', flags: [['Auto-flag: promotional language', true]] })}
    ${qItem({ name: 'Loops', who: '@noa', lvl: 'Contributor', age: '9h' })}
    ${qItem({ name: 'PaperTrail', who: '@dev.itai', lvl: 'New', age: '1d', flags: [['New account', false]] })}
    ${qItem({ name: 'Vocab', who: '@shira', lvl: 'Reviewer', age: '1d' })}
    ${qItem({ name: 'Snapsplit', who: '@tomer', lvl: 'New', age: '2d', flags: [['Possible duplicate', true]], claimed: 'Being reviewed by @dana' })}
  </div>
  <div style="display:flex;flex-direction:column;min-height:0">
    <div style="flex:1;overflow:hidden;padding:28px 36px;display:flex;flex-direction:column;gap:24px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px">
        <div style="display:flex;gap:16px;align-items:center">${tile('receiptly', 60)}<div><div style="display:flex;align-items:center;gap:10px"><h1 class="disp" style="font-size:34px;margin:0">Receiptly</h1><span class="pillstat" style="background:${A.amber};color:${A.amberInk};border:2px solid ${A.ink}">Maker claim</span></div><div style="color:${A.muted};margin-top:2px">Photographs a receipt and splits line items between named people.</div></div></div>
        <div style="display:flex;gap:8px"><a href="#" class="btn btn-xs" style="text-decoration:none;color:${A.ink}">Open live site ${svg(P.external, 15)}</a><button class="ghost">Release claim</button></div>
      </div>
      <div style="display:grid;grid-template-columns:minmax(0, 1fr) minmax(0, 1fr);gap:20px">
        <div class="panel" style="padding:20px;display:flex;flex-direction:column;gap:12px">
          <div class="h3" style="font-size:18px">Evidence</div>
          <div style="font-size:14.5px;display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;justify-content:space-between;gap:12px"><span style="color:${A.muted}">Fetched page title</span><span>Receiptly, split any receipt</span></div>
            <div style="display:flex;justify-content:space-between;gap:12px"><span style="color:${A.muted}">Submitted name</span><span style="display:flex;align-items:center;gap:6px">Receiptly ${svg(P.check, 14, A.violet, 2.5)}</span></div>
            <div style="display:flex;justify-content:space-between;gap:12px"><span style="color:${A.muted}">Link health</span><span style="display:flex;align-items:center;gap:6px">200 OK, 0.4s ${svg(P.check, 14, A.violet, 2.5)}</span></div>
            <div style="display:flex;justify-content:space-between;gap:12px"><span style="color:${A.muted}">Spanish interface claim</span><span style="color:${A.amberInk};font-weight:600">No screenshot attached</span></div>
          </div>
          <div style="height:100px;border-radius:14px;background:${A.sunk};border:2px solid ${A.rule};display:flex;align-items:center;justify-content:center;gap:8px;color:${A.faint};font-size:13.5px">${svg(P.image, 20, A.faint)}Live homepage capture</div>
        </div>
        <div class="panel" style="padding:20px;display:flex;flex-direction:column;gap:12px">
          <div class="h3" style="font-size:18px">Nearest existing listings</div>
          <div class="tab" style="display:flex;flex-direction:column;gap:10px;font-size:14.5px">
            ${[['splitwise', 'Splitwise', '0.61'], ['tricount', 'Tricount', '0.58'], ['spliddit', 'Spliddit', '0.74']].map(([k, n, s]) => `<div style="display:flex;align-items:center;gap:10px">${tile(k, 30)}<span style="flex:1;font-weight:500">${n}</span><span style="color:${parseFloat(s) > 0.7 ? A.amberInk : A.muted};font-weight:${parseFloat(s) > 0.7 ? 700 : 400}">${s} similar</span><a href="#" style="font-size:13.5px;font-weight:600">Compare</a></div>`).join('')}
          </div>
          <div style="font-size:13.5px;color:${A.muted};line-height:1.5;border-top:2px solid ${A.rule};padding-top:10px">Spliddit overlaps on “split a bill unevenly” but has no receipt scanning. Likely distinct.</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="h3" style="font-size:18px">Checklist</div>
        ${checkItem('Does the summary describe function, not marketing?', true)}
        ${checkItem('Are the problem statements specific?', true)}
        ${checkItem('Do the constraint claims match the site? <span style="color:' + A.amberInk + ';font-weight:600">Spanish claim unconfirmed</span>', false)}
      </div>
    </div>
    <div style="border-top:2px solid ${A.ink};padding:16px 36px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:${A.surface}">
      <div style="display:flex;gap:10px"><button class="btn btn-sm btn-lime">Approve</button><button class="btn btn-sm">Request changes</button><button class="btn btn-sm">${svg(P.dup, 16)}Merge duplicate</button></div>
      <button class="btn btn-sm btn-danger">Reject</button>
    </div>
  </div>
</div>
</div>`);

// =====================================================================================
// 6. Claim a tool · maker dashboard · edit your own listing
// =====================================================================================
files['ClaimTool.dc.html'] = page(`<div style="min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header({ signedIn: true })}
<main style="max-width:680px;margin:0 auto;padding:36px 24px 44px;width:100%;display:flex;flex-direction:column;gap:22px">
  <div style="font-size:14px;color:${A.muted};display:flex;gap:8px;align-items:center"><a href="#" style="color:${A.muted}">Splitwise</a>${svg(P.chevronR, 14, A.faint)}<span>Claim this tool</span></div>
  <div style="display:flex;gap:20px;align-items:center">${tile('splitwise', 72)}<div><h1 class="disp" style="font-size:44px;margin:0">Is Splitwise yours?</h1><div style="color:${A.muted};font-size:16px;margin-top:4px">We added it at launch, so nobody looks after it yet. Nothing to paste, nothing to wait for.</div></div></div>
  <div class="card" style="padding:26px;display:flex;flex-direction:column;gap:18px;box-shadow:6px 6px 0 ${A.violet}">
    <button class="btn btn-coral" style="height:60px;font-size:18px;width:100%">${svg(P.shield, 19, '#fff', 2.25)}Yes, I made Splitwise</button>
    <div style="display:flex;flex-direction:column;gap:8px">
      <label style="font-size:14.5px;font-weight:600;display:flex;gap:8px;align-items:baseline">Anything that shows it's you?<span style="font-weight:500;color:${A.faint}">Optional</span></label>
      <span class="field" style="height:50px;font-size:15px;color:${A.faint}">github.com/you/splitwise, a post, your name on the About page…</span>
      <div style="font-size:13.5px;color:${A.faint};line-height:1.5">Only used if someone else claims the same tool. Skip it and the claim still goes through.</div>
    </div>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:12px 26px;font-size:15px;color:${A.muted}">
    ${['Edit the listing whenever it changes', 'A dashboard of the searches that find you', 'A Maker badge on your profile'].map(t => `<span style="display:flex;align-items:center;gap:8px">${svg(P.check, 17, A.lime, 3)}${t}</span>`).join('')}
  </div>
  <div style="display:flex;align-items:flex-start;gap:10px;font-size:14.5px;color:${A.muted};padding:15px 17px;background:${A.sunk};border-radius:14px;line-height:1.55">${svg(P.info, 18, A.faint, 2, 'margin-top:1px;flex:none')}<span>The listing will say <strong style="color:${A.ink};font-weight:600">Maintained by @you</strong> where anyone can see it, and anyone can report that if it's not true. Only the tools we added at launch can be claimed — anything a person added belongs to them. Ratings and reviews stay exactly as they are, and you can reply to any of them.</span></div>
  <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
    <a href="#" class="ghost" style="height:44px;text-decoration:none">Cancel</a>
    <span style="font-size:14px;color:${A.faint}">Not your tool? <a href="#">Report something wrong instead</a></span>
  </div>
</main>
</div>`);

const statTile = (n, label, sub, accent) => `<div class="card" style="padding:22px;display:flex;flex-direction:column;gap:6px;box-shadow:5px 5px 0 ${accent}"><div class="disp tab" style="font-size:42px">${n}</div><div style="font-weight:600;font-size:15px">${label}</div><div style="font-size:13.5px;color:${A.muted};line-height:1.4">${sub}</div></div>`;
files['MakerDashboard.dc.html'] = page(`<div style="min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header({ signedIn: true })}
<main style="max-width:1280px;margin:0 auto;padding:20px 56px 80px;width:100%;display:flex;flex-direction:column;gap:26px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px">
    <div style="display:flex;gap:20px;align-items:center">${tile('receiptly', 72)}<div><div style="display:flex;align-items:center;gap:12px"><h1 class="disp" style="font-size:44px;margin:0">Receiptly</h1><span class="pillstat" style="background:${A.lime};border:2px solid ${A.ink};height:28px;gap:6px">${svg(P.shield, 14, A.ink, 2.25)}You maintain this</span></div><div style="color:${A.muted};font-size:15px;margin-top:4px">Yours since 12 Aug 2026 · Added by <a href="#" style="font-weight:600">@priya</a></div></div></div>
    <div style="display:flex;gap:8px"><a href="#" class="btn btn-sm" style="text-decoration:none;color:${A.ink}">View public page ${svg(P.external, 15)}</a><a href="#" class="btn btn-sm btn-coral" style="text-decoration:none;color:#fff">${svg(P.edit, 16, '#fff')}Edit listing</a></div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(4, minmax(0, 1fr));gap:20px">
    ${statTile('1,240', 'Searches matched', 'Last 30 days, up 18%', A.violet)}
    ${statTile('312', 'Opened from Foundit', '25% of people who saw it', A.coral)}
    ${statTile('148', 'Saved', 'Into 96 collections', A.ink)}
    ${statTile('4.5', 'Rating', 'From 34 ratings', A.lime)}
  </div>
  <div style="display:grid;grid-template-columns:minmax(0, 1fr) 380px;gap:32px;align-items:start">
    <div class="panel" style="padding:24px;display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;justify-content:space-between;align-items:baseline"><h2 class="h3">What people searched to find you</h2><span style="font-size:13.5px;color:${A.muted}">Last 30 days</span></div>
      ${[['“split a restaurant bill when we all ordered different stuff”', 412, 92], ['“app that reads a receipt and divides it between 4 people”', 288, 88], ['“track flat groceries without a spreadsheet”', 191, 74], ['“scan receipts without making an account”', 166, 81], ['“split costs in euros and pesos”', 84, 46]].map(([q, n, fit]) => `<div style="display:flex;flex-direction:column;gap:6px;padding-bottom:12px;border-bottom:2px solid ${A.rule}"><div style="display:flex;justify-content:space-between;gap:16px;align-items:baseline"><span style="font-size:15px">${q}</span><span class="tab" style="font-size:13.5px;color:${A.muted};white-space:nowrap">${n} searches</span></div><div style="display:flex;align-items:center;gap:10px"><div style="flex:1;height:8px;border-radius:999px;background:#EFEBE2;border:1.5px solid ${A.rule};overflow:hidden"><div style="width:${fit}%;height:100%;background:${fit >= 80 ? A.violet : A.faint}"></div></div><span class="tab" style="font-size:12.5px;color:${A.muted};width:64px">fits ${fit}</span></div></div>`).join('')}
      <div style="font-size:14px;color:${A.muted};line-height:1.5">The last one scores low because Receiptly doesn’t list multi-currency support. If it does that now, <a href="#">add it to the listing</a> and you’ll start matching those searches.</div>
    </div>
    <aside style="display:flex;flex-direction:column;gap:20px">
      <div class="slab" style="padding:22px;display:flex;flex-direction:column;gap:14px;box-shadow:6px 6px 0 ${A.lime}">
        <div class="h3" style="font-size:19px">Make it findable in more places</div>
        <div style="display:flex;flex-direction:column;gap:10px;font-size:14.5px">
          <div style="display:flex;gap:10px;align-items:flex-start">${svg(P.check, 18, A.violet, 2.5, 'margin-top:2px')}<span>Two problem statements written</span></div>
          <div style="display:flex;gap:10px;align-items:flex-start">${svg(P.plus, 18, A.coral, 2.5, 'margin-top:2px')}<span><a href="#" style="font-weight:600">Add a third statement</a> to reach “multi-currency” searches, 41 last month</span></div>
          <div style="display:flex;gap:10px;align-items:flex-start">${svg(P.plus, 18, A.coral, 2.5, 'margin-top:2px')}<span><a href="#" style="font-weight:600">Add two screenshots</a>. Listings with four get opened 30% more often</span></div>
        </div>
      </div>
      <div class="panel" style="padding:22px;display:flex;flex-direction:column;gap:12px">
        <div class="h3" style="font-size:19px">Latest reviews</div>
        ${[['D', '4.0', 'Saved our flat a weekly argument. Scanning is quick; the split screen could be clearer.', '#F4E4D3', '#8A4E1C'], ['J', '5.0', 'Works exactly as described and no account needed. Rare.', '#DCEBE3', '#1F5A48']].map(([i, r, body, bg, fg]) => `<div style="display:flex;gap:12px;align-items:flex-start;padding-top:12px;border-top:2px solid ${A.rule}">${avatar(i, 34, bg, fg)}<div style="flex:1"><div class="tab" style="font-size:13px;color:${A.muted};margin-bottom:2px">${r} out of 5</div><div style="font-size:14.5px;line-height:1.5">${body}</div></div></div>`).join('')}
        <a href="#" style="font-size:14.5px;font-weight:600">All 34 reviews</a>
      </div>
    </aside>
  </div>
</main>
</div>`);

const editField = (label, value, multi = false) => `<div style="display:flex;flex-direction:column;gap:8px">
  <div style="font-size:13.5px;color:${A.muted};font-weight:500">${label}</div>
  <div class="field${multi ? ' area' : ''}">${value}</div>
</div>`;
files['EditListing.dc.html'] = page(`<div style="min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header({ signedIn: true })}
<div style="background:${A.tint};border-top:2px solid ${A.ink};border-bottom:2px solid ${A.ink};padding:12px 56px;display:flex;justify-content:space-between;align-items:center;font-size:15px"><span style="display:flex;align-items:center;gap:8px">${svg(P.shield, 16, A.violet, 2.25)}You maintain this listing. Changes go live as soon as you save.</span><a href="#" style="font-weight:600">View public page</a></div>
<main style="max-width:1280px;margin:0 auto;padding:32px 56px 120px;width:100%;display:grid;grid-template-columns:minmax(0, 1fr) 340px;gap:56px;align-items:start">
  <div style="display:flex;flex-direction:column;gap:26px">
    <div style="display:flex;gap:20px;align-items:center">${tile('receiptly', 72)}<div><h1 class="disp" style="font-size:42px;margin:0">Receiptly</h1><div style="color:${A.muted};font-size:14.5px">Last edited by you, 12 Aug 2026</div></div></div>
    ${editField('Name', 'Receiptly')}
    ${editField('One-line summary <span class="tab">· 66 / 120</span>', 'Photographs a receipt and splits line items between named people.', true)}
    <div style="display:flex;flex-direction:column;gap:10px"><div style="font-size:13.5px;color:${A.muted};font-weight:500">Problems it solves</div>${editField('', 'Splitting a restaurant bill when everyone ordered different things and nobody wants to do the maths', true)}${editField('', 'Keeping track of shared groceries in a flat by photographing the receipt', true)}<button class="ghost" style="align-self:flex-start;color:${A.violet};font-weight:600">${svg(P.plus, 16, 'currentColor', 2.5)}Add a third statement</button></div>
    <div style="display:flex;flex-direction:column;gap:8px"><div style="font-size:13.5px;color:${A.muted};font-weight:500">Languages</div><div class="field area" style="min-height:56px;padding:8px 10px;gap:8px;flex-wrap:wrap;flex-direction:row;align-items:center"><span class="pill sm">English ${svg(P.x, 13)}</span><span class="pill sm">Spanish ${svg(P.x, 13)}</span><span class="pill sm">Portuguese ${svg(P.x, 13)}</span><span class="ph" style="padding:0 6px">Type to add a language</span></div></div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="font-size:13.5px;color:${A.muted};font-weight:500">Pricing</div>
      <div class="panel" style="overflow:hidden">
        <div class="tab" style="display:grid;grid-template-columns:120px 130px minmax(0, 1fr);gap:16px;padding:12px 16px;font-size:15px;border-bottom:1.5px solid ${A.rule}"><strong style="font-weight:700">Free</strong><span>$0</span><span>Unlimited receipts, no account</span></div>
        <div class="tab" style="display:grid;grid-template-columns:120px 130px minmax(0, 1fr);gap:16px;padding:12px 16px;font-size:15px"><strong style="font-weight:700">Plus</strong><span>$2.99 / mo</span><span>Multi-currency and export</span></div>
      </div>
      <button class="ghost" style="align-self:flex-start;color:${A.violet};font-weight:600">${svg(P.plus, 16, 'currentColor', 2.5)}Add a plan</button>
    </div>
    ${editField('Works offline', 'Partly. Entries queue and sync when back online')}
  </div>
  <aside style="display:flex;flex-direction:column;gap:16px;position:sticky;top:24px">
    <div class="slab" style="padding:22px;display:flex;flex-direction:column;gap:12px;box-shadow:6px 6px 0 ${A.violet}">
      <div class="h3" style="font-size:19px">Unsaved changes</div>
      <div style="display:flex;flex-direction:column;gap:8px;font-size:14.5px"><div style="padding:10px 12px;background:${A.tint};border-radius:12px"><div style="color:${A.muted};font-size:12.5px;font-weight:600">Languages</div><div>Added Portuguese</div></div></div>
      <div style="font-size:13px;color:${A.faint};line-height:1.5">Every version is kept, so you can undo a change later.</div>
    </div>
    <div class="panel" style="padding:20px;display:flex;flex-direction:column;gap:10px;font-size:14px;color:${A.muted};line-height:1.5">${svg(P.info, 18, A.faint, 2)}Ratings and reviews belong to the people who wrote them. Reply to any of them from the listing, in your own name.</div>
  </aside>
</main>
<div style="position:sticky;bottom:0;margin-top:auto;border-top:2px solid ${A.ink};background:${A.surface};padding:16px 56px;display:flex;justify-content:space-between;align-items:center">
  <div style="font-size:16px"><strong class="disp" style="font-size:20px;font-weight:800">1 change</strong> <span style="color:${A.muted}">Languages</span></div>
  <div style="display:flex;gap:10px"><button class="ghost" style="height:44px">Discard</button><button class="btn btn-coral">Save and publish</button></div>
</div>
</div>`);
// 7. Rate & review (modal) + 8. Save gate (modal)
// =====================================================================================
const slider = (label, v) => `<div style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;justify-content:space-between;font-size:14.5px;font-weight:500"><span>${label}</span><span class="tab" style="color:${A.muted}">${v} / 5</span></div><div style="position:relative;height:12px;border-radius:999px;background:#EFEBE2;border:2px solid ${A.ink}"><div style="position:absolute;left:0;top:0;height:100%;width:${(v - 1) * 25}%;background:${A.violet};border-radius:999px"></div><span style="position:absolute;top:50%;left:${(v - 1) * 25}%;transform:translate(-50%,-50%);width:24px;height:24px;border-radius:50%;background:${A.surface};border:2px solid ${A.ink};box-shadow:2px 2px 0 ${A.ink}"></span></div></div>`;
const dimmedResults = `<div style="padding:8px 56px;opacity:.55;pointer-events:none;max-width:1280px;margin:0 auto;display:flex;flex-direction:column;gap:26px">${userBubble(QUERY)}<div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:28px;padding:6px 0 0 56px">${resultCard(RESULTS[0], true, 0)}${resultCard(RESULTS[1], false, 1)}</div></div>`;
files['RateReview.dc.html'] = page(`<div style="height:900px;background:${A.bg};position:relative;overflow:hidden">
${header({ signedIn: true })}
<div style="padding:40px 56px;opacity:.5;max-width:1280px;margin:0 auto;display:flex;gap:22px;align-items:center">${tile('splitwise', 84)}<div><div class="disp" style="font-size:52px">Splitwise</div><div style="font-size:19px;color:${A.muted}">Splits shared expenses across a group and tells everyone who owes what.</div></div></div>
<div style="position:absolute;inset:0;background:rgba(28,26,36,.45);display:flex;align-items:flex-start;justify-content:center;padding-top:56px">
  <div role="dialog" aria-label="Rate Splitwise" class="rise" style="width:600px;background:${A.surface};border:2px solid ${A.ink};border-radius:24px;box-shadow:10px 10px 0 ${A.violet};padding:32px 36px 28px;display:flex;flex-direction:column;gap:24px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start"><div><div style="font-size:14px;font-weight:600;color:${A.muted};margin-bottom:6px">Splitwise</div><h1 class="disp" style="font-size:32px;margin:0">How well did it work for you?</h1></div><button class="ghost" style="padding:0 8px;margin:-6px -12px 0 0" aria-label="Close">${svg(P.x, 20)}</button></div>
    <div style="display:flex;align-items:center;gap:14px">${stars(5, 38)}<span class="disp" style="font-size:20px;font-weight:700;color:${A.violet}">Solved it completely</span></div>
    <div style="display:flex;flex-direction:column;gap:8px"><label style="font-weight:600;font-size:15px">What did you use it for? <span style="color:${A.coral}">*</span></label><div class="field area" style="min-height:60px">Splitting costs on a two-week trip with 6 people</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:2px">${['A group trip', 'A shared flat', 'Settling up in another currency'].map(x => `<span class="pill sm flat" style="height:32px;font-size:13px">${x}</span>`).join('')}</div></div>
    <div style="display:flex;flex-direction:column;gap:10px"><label style="font-weight:600;font-size:15px">Would you recommend it for…</label><div style="display:flex;flex-wrap:wrap;gap:6px"><span class="pill sm on" style="height:34px">${svg(P.check, 13, '#fff', 3)}Trips</span><span class="pill sm on" style="height:34px">${svg(P.check, 13, '#fff', 3)}Shared flats</span><span class="pill sm flat" style="height:34px">Couples</span><span class="pill sm flat" style="height:34px;color:${A.faint};text-decoration:line-through">Business expenses</span></div><div style="font-size:13px;color:${A.faint}">Tap once to recommend, twice for “not for this”.</div></div>
    <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:22px">${slider('Easy to start', 4)}${slider('Worth the price', 4)}${slider('Would use again', 5)}</div>
    <div style="display:flex;flex-direction:column;gap:8px"><label style="font-weight:600;font-size:15px">Written review <span style="color:${A.faint};font-weight:400">optional</span></label><div class="field area" style="min-height:96px"><span class="ph">What surprised you, good or bad? Specifics help more than adjectives.</span></div></div>
    <div style="display:flex;justify-content:space-between;align-items:center;border-top:2px solid ${A.rule};padding-top:20px"><div style="font-size:13px;color:${A.faint};max-width:260px;line-height:1.45">Reviews from accounts under 7 days old are held for a check.</div><div style="display:flex;gap:10px"><button class="ghost" style="height:44px">Cancel</button><button class="btn btn-coral">Post review</button></div></div>
  </div>
</div>
</div>`);
files['SaveGate.dc.html'] = page(`<div style="height:900px;background:${A.bg};position:relative;overflow:hidden">
${header()}
${dimmedResults}
<div style="position:absolute;inset:0;background:rgba(28,26,36,.45);display:flex;align-items:center;justify-content:center">
  <div role="dialog" aria-label="Save Splitwise" class="rise" style="width:480px;background:${A.surface};border:2px solid ${A.ink};border-radius:24px;box-shadow:10px 10px 0 ${A.coral};padding:32px 34px 26px;display:flex;flex-direction:column;gap:18px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div style="display:flex;gap:14px;align-items:center">${tile('splitwise', 52)}<div><h1 class="disp" style="font-size:28px;margin:0;line-height:1.05">Save Splitwise to your collection</h1></div></div><button class="ghost" style="padding:0 8px;margin:-6px -12px 0 0" aria-label="Close">${svg(P.x, 20)}</button></div>
    <div style="color:${A.muted};line-height:1.5;font-size:15.5px">Sign in to keep this tool, and everything else you save. Free, no card, about five seconds.</div>
    <button class="btn" style="width:100%">${gLogo}Continue with Google</button>
    <button class="btn" style="width:100%;margin-top:-6px">${appleLogo}Continue with Apple</button>
    <div style="display:flex;align-items:center;gap:12px;color:${A.faint};font-size:13px;font-weight:600"><div class="rule thin" style="flex:1"></div>or<div class="rule thin" style="flex:1"></div></div>
    <div style="display:flex;gap:8px"><div class="field" style="flex:1"><span class="ph">you@example.com</span></div><button class="btn btn-coral" style="padding:0 18px">Email me a code</button></div>
    <div style="font-size:13px;color:${A.muted};display:flex;align-items:center;gap:8px;background:${A.tint};padding:10px 12px;border-radius:12px">${svg(P.bookmark, 15, A.violet, 2.25)}We’ll add Splitwise to your collection as soon as you’re in.</div>
    <div style="font-size:12.5px;color:${A.faint};text-align:center;line-height:1.5">By continuing you agree to the <a href="#" style="color:${A.muted}">Terms</a> and <a href="#" style="color:${A.muted}">Privacy Policy</a>.</div>
  </div>
</div>
</div>`);

// =====================================================================================
// 9. Saved
// =====================================================================================
const savedCard = ({ k, name, summary, tags, note, rot }) => `<div class="card hov" style="padding:22px;display:flex;flex-direction:column;gap:14px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start"><div style="display:flex;gap:12px;align-items:center">${tile(k, 46)}<div><div class="disp" style="font-size:22px;font-weight:700">${name}</div><div class="tab" style="font-size:13px;color:${A.faint};font-weight:500">Saved 3 days ago</div></div></div><button class="ghost" style="padding:0 6px" aria-label="More">${svg(P.more, 20)}</button></div>
  <div style="color:${A.muted};font-size:15px;line-height:1.5">${summary}</div>
  <div style="display:flex;flex-wrap:wrap;gap:6px">${tags.map(x => `<span class="tag">${x}</span>`).join('')}</div>
  <div style="font-size:14px;line-height:1.5;padding:12px 14px;border-radius:12px;background:${note ? A.tint : A.sunk};color:${note ? A.ink : A.faint};border:2px dashed ${note ? 'transparent' : A.rule}">${note || 'Why did you save this? e.g. “Backup option if Tricount’s currency handling is bad.”'}</div>
</div>`;
files['Saved.dc.html'] = page(`<div style="min-min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header({ active: 'saved', signedIn: true })}
<main style="max-width:1280px;margin:0 auto;padding:24px 56px 80px;width:100%;display:grid;grid-template-columns:240px minmax(0, 1fr);gap:48px;align-items:start">
  <nav style="display:flex;flex-direction:column;gap:6px;position:sticky;top:24px">
    <div class="disp" style="font-size:22px;font-weight:700;padding:0 12px 12px">Collections</div>
    ${[['All saved', 11], ['Trip planning', 4, true], ['Flat admin', 3], ['Recording and notes', 4]].map(([l, n, on]) => `<a href="#" style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:12px;font-size:15px;color:${A.ink};background:${on ? A.tint : 'transparent'};font-weight:${on ? 700 : 500};text-decoration:none;border:2px solid ${on ? A.ink : 'transparent'}">${l}<span class="tab" style="font-size:13px;color:${A.muted}">${n}</span></a>`).join('')}
    <button class="ghost" style="justify-content:flex-start;margin-top:8px;color:${A.violet};font-weight:600">${svg(P.plus, 16, 'currentColor', 2.5)}New collection</button>
  </nav>
  <div style="display:flex;flex-direction:column;gap:24px">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:20px">
      <div><h1 class="disp" style="font-size:46px;margin:0 0 8px">Trip planning</h1><div style="color:${A.muted};font-size:15px">Options for the Greece trip in October · 4 tools · Private</div></div>
      <div style="display:flex;gap:8px"><button class="btn btn-sm">${svg(P.share, 16)}Share</button><button class="btn btn-sm">${svg(P.dup, 16)}Duplicate</button></div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:16px">
      <div class="field" style="width:320px;height:44px;font-size:15px">${svg(P.search, 17, A.faint)}<span class="ph">Search within saved</span></div>
      <div style="display:flex;gap:10px;align-items:center"><div class="field" style="height:44px;font-size:14.5px"><span style="color:${A.muted}">Sort</span><strong style="font-weight:600">Recently saved</strong>${svg(P.chevron, 14)}</div><div style="display:flex;border:2px solid ${A.ink};border-radius:12px;overflow:hidden;background:${A.surface}"><span style="width:44px;height:40px;display:flex;align-items:center;justify-content:center;background:${A.ink};color:${A.bg}">${svg(P.grid, 17)}</span><span style="width:44px;height:40px;display:flex;align-items:center;justify-content:center;color:${A.muted}">${svg(P.list, 17)}</span></div></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:26px;padding:6px">
      ${savedCard({ k: 'splitwise', name: 'Splitwise', summary: 'Splits shared expenses across a group and tells everyone who owes what.', tags: ['Free', 'Spanish', 'iOS and Android'], note: 'Default choice, everyone already has it. Ads on free are tolerable.', rot: '-0.7deg' })}
      ${savedCard({ k: 'tricount', name: 'Tricount', summary: 'Group expense tracking without creating an account.', tags: ['Free', 'Spanish', 'No account'], note: 'Backup if Dana refuses to make an account. Check currency handling.', rot: '0.6deg' })}
      ${savedCard({ k: 'settleup', name: 'Settle Up', summary: 'Shared expenses with offline entry and later sync.', tags: ['Free tier', 'Works offline'], note: '', rot: '0.5deg' })}
      ${savedCard({ k: 'receiptly', name: 'Receiptly', summary: 'Photographs a receipt and splits line items between named people.', tags: ['Free', 'Spanish', 'iOS and Android'], note: 'For the restaurant nights specifically.', rot: '-0.5deg' })}
    </div>
  </div>
</main>
</div>`);

// =====================================================================================
// 10. Profile
// =====================================================================================
const statusPill = (s) => { const m = { Live: [A.lime, A.ink], 'Maintained by you': [A.tint, A.violet], 'In review': [A.tint, A.violet], 'Changes requested': [A.amber, A.amberInk], Rejected: [A.sunk, A.muted], Merged: [A.sunk, A.muted] }; return `<span class="pillstat" style="background:${m[s][0]};color:${m[s][1]};border:2px solid ${s === 'Rejected' || s === 'Merged' ? A.rule : A.ink}">${s}</span>`; };
files['Profile.dc.html'] = page(`<div style="min-min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header({ signedIn: true })}
<div style="border-top:2px solid ${A.ink};border-bottom:2px solid ${A.ink};background:${A.tint}">
  <div style="max-width:1280px;margin:0 auto;padding:44px 56px 0;display:flex;flex-direction:column;gap:28px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px">
      <div style="display:flex;gap:24px;align-items:center">
        ${avatar('P', 96, '#DFE6F2', '#2E4A7A')}
        <div style="display:flex;flex-direction:column;gap:6px">
          <div style="display:flex;align-items:center;gap:12px"><h1 class="disp" style="font-size:42px;margin:0">Priya Raman</h1><span class="pillstat" style="background:${A.coral};color:#fff;border:2px solid ${A.ink};height:28px;gap:6px" title="Founder: first to add a tool to Foundit. 24 so far.">${svg(P.star, 14, '#fff', 2.5)}Founder · 24</span><span class="pillstat" style="background:${A.lime};border:2px solid ${A.ink};height:28px;gap:6px" title="Maker: maintains a tool listed here.">${svg(P.shield, 14, A.ink, 2.25)}Maker</span></div>
          <div style="color:${A.muted};font-size:15px">@priya · Joined March 2025 · Madrid</div>
          <div style="max-width:560px;line-height:1.5">Indie maker. I list the small tools I actually use, and I’m picky about “free” meaning free.</div>
          <div style="font-size:15px;display:flex;align-items:center;gap:6px;font-weight:500">${svg(P.shield, 16, A.violet, 2.25)}Maker of <a href="#" style="font-weight:700">Receiptly</a></div>
        </div>
      </div>
      <button class="btn btn-sm">Edit profile</button>
    </div>
    <div class="tab" style="display:flex;gap:40px;font-size:15px;color:${A.muted};padding-bottom:24px">${[['24', 'tools added'], ['1', 'tool claimed'], ['47', 'reviews'], ['312', 'helpful votes'], ['1.4k', 'likes given']].map(([n, l]) => `<div><strong class="disp" style="font-size:26px;color:${A.ink};font-weight:800">${n}</strong> ${l}</div>`).join('')}</div>
    <div style="display:flex;gap:6px">${['Tools I added', 'Tools I maintain', 'Reviews', 'Collections', 'Likes'].map((t, i) => `<a href="#" style="padding:10px 16px;border:2px solid ${i === 0 ? A.ink : 'transparent'};border-bottom:0;border-radius:14px 14px 0 0;background:${i === 0 ? A.bg : 'transparent'};color:${A.ink};font-weight:${i === 0 ? 700 : 500};text-decoration:none;margin-bottom:-2px">${t}</a>`).join('')}</div>
  </div>
</div>
<main style="max-width:1280px;margin:0 auto;padding:28px 56px 80px;width:100%">
  <div class="panel" style="overflow:hidden">
    ${[['receiptly', 'Receiptly', 'Maintained by you', 'Added 4h ago', 'Maintained by you · 3 searches matched today'], ['otter', 'Otter Notes', 'Live', '12 Aug 2026', ''], ['habit', 'Habitual', 'Live', '30 Jul 2026', ''], ['ente', 'Greenscan', 'Live', '2 days ago', ''], ['vault', 'Vaultlet', 'Merged', '18 Jul 2026', 'Merged into Bitwarden'], ['loops', 'Loops', 'Live', '2 Jul 2026', '']].map(([k, n, s, d, note], i) => `<div style="display:grid;grid-template-columns:minmax(0, 1fr) 190px 160px 90px;gap:16px;align-items:center;padding:16px 22px;${i ? `border-top:2px solid ${A.rule}` : ''}">
      <div style="display:flex;align-items:center;gap:14px">${tile(k, 40)}<div><div class="disp" style="font-weight:700;font-size:18px">${n}</div>${note ? `<div style="font-size:13.5px;color:${s === 'Maintained by you' ? A.violet : A.muted}">${note}</div>` : ''}</div></div>
      <div>${statusPill(s)}</div>
      <div class="tab" style="font-size:14px;color:${A.muted}">${d}</div>
      <div style="text-align:right">${s === 'Maintained by you' ? `<a href="#" class="btn btn-xs" style="text-decoration:none;color:${A.ink}">Dashboard</a>` : `<a href="#" style="font-size:14.5px;font-weight:600">View</a>`}</div>
    </div>`).join('')}
  </div>
</main>
</div>`);

// =====================================================================================
// 11. Sign in
// =====================================================================================
files['SignIn.dc.html'] = page(`<div style="height:900px;background:${A.bg};display:flex;flex-direction:column;position:relative;overflow:hidden">
<div style="position:absolute;top:-160px;left:-120px;width:640px;height:640px;border-radius:50%;background:radial-gradient(circle, rgba(255,90,60,.12), transparent 62%);pointer-events:none"></div>
${header()}
<main style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 24px 60px;gap:22px;position:relative">
  <div style="text-align:center;max-width:460px">${mark(56)}<h1 class="disp" style="font-size:36px;margin:14px 0 8px">Sign in to keep what you save.</h1><div style="color:${A.muted};font-size:16px">No password. Pick a button, or we’ll email you a 6-digit code.</div></div>
  <div class="slab rise" style="width:440px;padding:30px;display:flex;flex-direction:column;gap:14px;box-shadow:8px 8px 0 ${A.violet}">
    <button class="btn" style="width:100%">${gLogo}Continue with Google</button>
    <button class="btn" style="width:100%">${appleLogo}Continue with Apple</button>
    <div style="display:flex;align-items:center;gap:12px;color:${A.faint};font-size:13px;font-weight:600;padding:4px 0"><div class="rule thin" style="flex:1"></div>or<div class="rule thin" style="flex:1"></div></div>
    <div style="display:flex;flex-direction:column;gap:8px"><label style="font-size:14px;font-weight:600">Email</label><div class="field">noa@example.com</div></div>
    <button class="btn btn-coral" style="width:100%">${svg(P.mail, 18, '#fff', 2.25)}Email me a code</button>
    <div style="font-size:12.5px;color:${A.faint};text-align:center;line-height:1.5;margin-top:4px">By continuing you agree to the <a href="#" style="color:${A.muted}">Terms</a> and <a href="#" style="color:${A.muted}">Privacy Policy</a>.</div>
  </div>
  <div style="font-size:14.5px;color:${A.muted};display:flex;align-items:center;gap:8px;background:${A.tint};padding:10px 16px;border-radius:999px;border:2px solid ${A.ink}">${svg(P.bookmark, 16, A.violet, 2.25)}Your 3 saved tools on this device will be kept.</div>
</main>
</div>`);

// =====================================================================================
// 12. Settings
// =====================================================================================
const setRow = (title, help, control, last = false) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:32px;padding:20px 0;${last ? '' : `border-bottom:2px solid ${A.rule}`}"><div><div style="font-weight:600;font-size:16px">${title}</div>${help ? `<div style="font-size:14.5px;color:${A.muted};margin-top:2px;line-height:1.5;max-width:520px">${help}</div>` : ''}</div>${control}</div>`;
files['Settings.dc.html'] = page(`<div style="min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header({ signedIn: true })}
<main style="max-width:1280px;margin:0 auto;padding:24px 56px 80px;width:100%;display:grid;grid-template-columns:240px minmax(0, 760px);gap:56px">
  <nav style="display:flex;flex-direction:column;gap:6px">
    <h1 class="disp" style="font-size:32px;margin:0 12px 14px">Settings</h1>
    ${[['user', 'Account', true], ['bell', 'Notifications'], ['lock', 'Privacy and data']].map(([i, l, on]) => `<a href="#" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;font-size:15px;color:${A.ink};background:${on ? A.tint : 'transparent'};font-weight:${on ? 700 : 500};text-decoration:none;border:2px solid ${on ? A.ink : 'transparent'}">${svg(P[i], 18, A.ink, 2)}${l}</a>`).join('')}
  </nav>
  <div style="display:flex;flex-direction:column;gap:40px">
    <section>
      <h2 class="h2" style="margin-bottom:6px">Account</h2>
      <div style="color:${A.muted};font-size:14.5px">Changes save as you make them.</div>
      <div style="margin-top:8px">
        ${setRow('Display name', '', `<div class="field" style="width:260px">Noa Ben-Ami</div>`)}
        ${setRow('Email', 'Used for sign-in codes and the notifications below.', `<div class="field" style="width:260px">noa@example.com</div>`)}
        ${setRow('Interface language', 'English for now. More languages are coming; you can already search in any language.', `<div class="field" style="width:260px;justify-content:space-between;color:${A.muted}">English ${svg(P.chevron, 16, A.faint)}</div>`)}
        ${setRow('Only show tools available in my language', 'When on, results are limited to tools with an English interface. It shows on every search as a chip you can remove.', `<span class="toggle"></span>`, true)}
      </div>
    </section>
    <section>
      <h2 class="h2" style="margin-bottom:10px;font-size:26px">Notifications</h2>
      <div style="display:grid;grid-template-columns:minmax(0, 1fr) 80px 80px;gap:12px;padding:8px 0;font-size:12.5px;font-weight:700;color:${A.muted};border-bottom:2px solid ${A.ink}"><span></span><span style="text-align:center">Email</span><span style="text-align:center">In-app</span></div>
      ${[['When someone reports a tool I maintain', 1, 1], ['When a tool I maintain gets a new review', 1, 1], ['When someone finds my review helpful', 0, 1], ['Weekly digest of new tools in your saved categories', 0, 0], ['A monthly summary for the tools I maintain', 1, 0]].map(([l, e, a], i, arr) => `<div style="display:grid;grid-template-columns:minmax(0, 1fr) 80px 80px;gap:12px;align-items:center;padding:14px 0;${i < arr.length - 1 ? `border-bottom:2px solid ${A.rule}` : ''};font-size:15px"><span>${l}</span><span style="display:flex;justify-content:center">${checkbox(!!e)}</span><span style="display:flex;justify-content:center">${checkbox(!!a)}</span></div>`).join('')}
    </section>
    <section>
      <h2 class="h2" style="margin-bottom:6px;font-size:26px">Privacy and data</h2>
      ${setRow('Use my searches to improve matching', 'Your searches help us learn which phrasings mean the same problem. Never shown to other users or makers.', `<span class="toggle on"></span>`)}
      ${setRow('Download my data', 'Saved items, likes, reviews, submissions and settings as a JSON file.', `<button class="btn btn-xs">${svg(P.download, 16)}Download</button>`)}
      ${setRow('Delete my account', 'Removes your profile, saved items, likes and reviews. Listings you submitted stay published, credited to a deleted account.', `<button class="btn btn-xs btn-danger">${svg(P.trash, 16)}Delete account</button>`, true)}
    </section>
  </div>
</main>
</div>`);

// =====================================================================================
// 13. Components
// =====================================================================================
const swatch = (name, hex) => `<div style="display:flex;flex-direction:column;gap:6px"><div style="height:64px;border-radius:14px;background:${hex};border:2px solid ${A.ink};box-shadow:3px 3px 0 ${A.ink}"></div><div style="font-size:13px;font-weight:600">${name}</div><div class="tab" style="font-size:12px;color:${A.faint}">${hex}</div></div>`;
const specRow = (label, content) => `<div style="display:grid;grid-template-columns:220px minmax(0, 1fr);gap:24px;padding:26px 0;border-top:2px solid ${A.rule};align-items:start"><div style="font-size:14px;color:${A.muted};line-height:1.5;padding-top:4px"><strong style="color:${A.ink};font-weight:700;display:block;margin-bottom:4px">${label.split('|')[0]}</strong>${label.split('|')[1] || ''}</div><div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">${content}</div></div>`;
files['Components.dc.html'] = page(`<div style="min-height:900px;background:${A.bg};padding:48px 56px 64px;display:flex;flex-direction:column">
  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:24px"><div>${wordmark(24)}<h1 class="disp" style="font-size:46px;margin:12px 0 0">Components and tokens</h1></div><div style="font-size:14px;color:${A.muted};max-width:440px;text-align:right;line-height:1.5">Bricolage Grotesque for display, Onest for interface. Coral is the action colour, violet is structure, lime is reward. Ink borders are always 2px; offset shadows press down.</div></div>
  ${specRow('Logo|A speech bubble that found something. The mark sits at 34px in the header, 56px on sign-in.', `<div style="display:flex;gap:40px;align-items:center">${wordmark(40)}${mark(72)}<div style="background:${A.ink};padding:16px 20px;border-radius:16px;display:flex;align-items:center;gap:10px">${mark(34)}<span class="disp" style="font-size:30px;color:${A.bg}">Found<span style="color:${A.coral}">it</span></span></div></div>`)}
  ${specRow('Colour|Cream ground, one action colour, one structural colour, one reward colour. Amber for “needs attention”, red only for destructive actions.', `<div style="display:grid;grid-template-columns:repeat(8, 118px);gap:16px">${swatch('Cream', A.bg)}${swatch('Surface', A.surface)}${swatch('Tint', A.tint)}${swatch('Ink', A.ink)}${swatch('Coral', A.coral)}${swatch('Violet', A.violet)}${swatch('Lime', A.lime)}${swatch('Amber', A.amber)}</div>`)}
  ${specRow('Type|Bricolage Grotesque 800 for display, 700 for headings and card titles. Onest 400 to 600 for everything else.', `<div style="display:flex;flex-direction:column;gap:12px;width:100%"><div class="disp" style="font-size:78px">Say what’s bugging you.</div><div class="h2">Solves these problems, 32 / 700</div><div class="disp" style="font-size:24px;font-weight:700">Card title, 24 / 700</div><div style="font-size:16px">Interface body, 16 Onest · <span class="muted">muted 16</span> · <strong style="font-weight:600">emphasis 600</strong></div></div>`)}
  ${specRow('Fit score|The signature element. A gradient meter from violet through coral to lime, with the numeral riding its end and counting up.', `<div style="display:flex;flex-direction:column;gap:22px;width:560px">${meter(92, 'strong match')}${meter(74, 'partial match')}${meter(48, 'weak match')}</div>`)}
  ${specRow('Constraint chips|Filled = explicit, dashed = inferred, struck = removed. Legible without colour.', `<button class="pill sm on">Free ${svg(P.x, 14, '#fff', 2.25)}</button><button class="pill sm soft">Mobile ${svg(P.x, 14, 'currentColor', 2.25)}</button><button class="pill sm flat" style="color:${A.faint};text-decoration:line-through">Offline</button><button class="pill sm flat">${svg(P.plus, 16, 'currentColor', 2.25)}Add a constraint</button><button class="pill">Example prompt chip</button>`)}
  ${specRow('Satisfaction chips|Met is tinted violet with a check. Unmet is neutral with a dash, never red.', `<span class="sat">${svg(P.check, 14, 'currentColor', 2.25)}Free</span><span class="sat">${svg(P.check, 14, 'currentColor', 2.25)}Spanish, full interface</span><span class="sat unmet">${svg(P.dash, 14, 'currentColor', 2.25)}No offline mode</span><span class="tag">Neutral tag</span>`)}
  ${specRow('Buttons|Hover moves 2px into the shadow, press lands flat. 44px minimum height.', `<button class="btn btn-coral">Open Splitwise ${svg(P.external, 16, '#fff')}</button><button class="btn">${svg(P.bookmark, 16)}Save</button><button class="btn btn-lime">Approve</button><button class="btn btn-violet">Continue</button><button class="btn btn-danger">Reject</button><button class="ghost" style="height:44px">Not now</button><button class="btn btn-sm">Small</button><button class="btn btn-xs">Extra small</button>`)}
  ${specRow('Likes and saves|Like is a light public signal that feeds ranking. Save is the private, primary action.', `${like('218')}${like('219', true)}<button class="btn btn-sm">${svg(P.bookmark, 16)}Save</button><button class="btn btn-sm" style="background:${A.tint}"><svg width="18" height="18" viewBox="0 0 24 24" fill="${A.violet}" stroke="${A.ink}" stroke-width="2">${P.bookmark}</svg>Saved</button>`)}
  ${specRow('Status pills', `${statusPill('Live')}${statusPill('In review')}${statusPill('Changes requested')}${statusPill('Rejected')}<span class="pillstat" style="background:${A.coral};color:#fff;border:2px solid ${A.ink};gap:5px">${svg(P.star, 13, '#fff', 2.5)}Founder</span><span class="pillstat" style="background:${A.lime};border:2px solid ${A.ink};gap:6px">${svg(P.shield, 13, A.ink, 2.25)}Maintained by the maker</span>`)}
  ${specRow('Form controls', `${checkbox(true)}${checkbox(false)}<span class="radio on"></span><span class="radio"></span><span class="toggle on"></span><span class="toggle"></span><div class="field" style="width:260px">noa@example.com</div><div class="field" style="width:220px"><span class="ph">Placeholder</span></div>`)}
</div>`);

// =====================================================================================
// 14. Enter code (after "Email me a code")
// =====================================================================================
const codeBox = (v, active = false) => `<div style="width:56px;height:64px;border:2px solid ${active ? A.coral : A.ink};border-radius:14px;background:${A.surface};display:flex;align-items:center;justify-content:center;font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:28px;${active ? `box-shadow:3px 3px 0 ${A.coral}` : ''}">${v}${active ? `<span style="width:2px;height:28px;background:${A.coral};animation:caret 1s steps(2) infinite"></span>` : ''}</div>`;
files['EnterCode.dc.html'] = page(`<div style="height:900px;background:${A.bg};display:flex;flex-direction:column;position:relative;overflow:hidden">
<div style="position:absolute;top:-160px;left:-120px;width:640px;height:640px;border-radius:50%;background:radial-gradient(circle, rgba(255,90,60,.12), transparent 62%);pointer-events:none"></div>
${header()}
<main style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 24px 60px;gap:22px;position:relative">
  <div style="text-align:center;max-width:480px">${mark(56)}<h1 class="disp" style="font-size:36px;margin:14px 0 8px">Check your email.</h1><div style="color:${A.muted};font-size:16px;line-height:1.5">We sent a 6-digit code to <strong style="color:${A.ink};font-weight:600">noa@example.com</strong>. It expires in 15 minutes.</div></div>
  <div class="slab rise" style="width:480px;padding:30px;display:flex;flex-direction:column;gap:18px;box-shadow:8px 8px 0 ${A.violet}">
    <div style="display:flex;gap:10px;justify-content:center">${codeBox('4')}${codeBox('8')}${codeBox('2')}${codeBox('', true)}${codeBox('')}${codeBox('')}</div>
    <button class="btn btn-coral" style="width:100%">Continue</button>
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:14px"><button class="ghost" style="color:${A.faint}" disabled>Resend in 0:28</button><a href="#" style="font-weight:600">Use a different email</a></div>
  </div>
  <div style="font-size:14.5px;color:${A.muted};display:flex;align-items:center;gap:8px;background:${A.tint};padding:10px 16px;border-radius:999px;border:2px solid ${A.ink}">${svg(P.bookmark, 16, A.violet, 2.25)}Your 3 saved tools on this device will be kept.</div>
</main>
</div>`);

// =====================================================================================
// 15-17. Results states: clarifier, loading, nothing fits
// =====================================================================================
const chatInput = (ph = 'Add more, or change something. e.g. “it also needs to work offline” or “forget Spanish, English is fine”') => `<div style="position:sticky;bottom:0;padding:16px 56px 28px;background:linear-gradient(to top, ${A.bg} 70%, transparent);margin-top:auto">
  <div class="slab" style="max-width:1168px;margin:0 auto;position:relative;padding:18px 84px 18px 24px;min-height:72px;display:flex;align-items:center"><div style="font-size:17px;color:${A.faint}">${ph}</div><button class="btn btn-coral" aria-label="Send" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);width:52px;height:52px;padding:0;border-radius:14px">${svg(P.arrowUp, 24, '#fff', 2.25)}</button></div>
</div>`;
const understood = (chips) => `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding-top:6px"><span style="font-weight:600;color:${A.muted};margin-right:6px">Here’s what I understood</span>${chips.map(([l, soft]) => `<button class="pill sm ${soft ? 'soft' : 'on'}">${l} ${svg(P.x, 14, soft ? 'currentColor' : '#fff', 2.25)}</button>`).join('')}<button class="pill sm flat">${svg(P.plus, 16, 'currentColor', 2.25)}Add a constraint</button></div>`;
const skeletonCard = (d) => `<div class="card rise" style="padding:26px;display:flex;flex-direction:column;gap:16px;animation-delay:${d}ms;box-shadow:6px 6px 0 ${A.rule};border-color:${A.rule}"><div style="height:14px;border-radius:999px;background:#EFEBE2;border:2px solid ${A.rule};overflow:hidden;position:relative"><div style="position:absolute;inset:0;width:30%;background:linear-gradient(90deg, transparent, rgba(255,255,255,.9), transparent);animation:shimmer 1.4s ease-in-out infinite"></div></div><div style="display:flex;gap:14px;align-items:center"><span style="width:48px;height:48px;border-radius:12px;background:${A.sunk}"></span><div style="flex:1;display:flex;flex-direction:column;gap:8px"><span style="height:18px;width:40%;border-radius:6px;background:${A.sunk}"></span><span style="height:12px;width:80%;border-radius:6px;background:${A.sunk}"></span></div></div><div style="height:64px;border-radius:14px;background:${A.sunk}"></div><div style="display:flex;gap:8px"><span style="height:30px;width:70px;border-radius:999px;background:${A.sunk}"></span><span style="height:30px;width:120px;border-radius:999px;background:${A.sunk}"></span><span style="height:30px;width:90px;border-radius:999px;background:${A.sunk}"></span></div></div>`;
files['ResultsClarifier.dc.html'] = page(`<div style="min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header()}
<main style="max-width:1280px;margin:0 auto;padding:8px 56px 40px;display:flex;flex-direction:column;gap:26px;width:100%">
  ${userBubble('I need something to keep track of who paid for what')}
  <div style="display:flex;gap:16px;align-items:flex-start">${mark(40)}<div style="flex:1;display:flex;flex-direction:column;gap:22px;min-width:0">
    ${understood([['Shared expenses', false], ['Group', true]])}
    <div class="slab rise" style="padding:28px 30px;display:flex;flex-direction:column;gap:16px;max-width:760px;box-shadow:6px 6px 0 ${A.coral};animation-delay:150ms">
      <div style="font-size:13px;font-weight:700;color:${A.coral}">One quick question</div>
      <div class="disp" style="font-size:30px;font-weight:800;line-height:1.1">Is this for a one-off trip, or ongoing shared costs like a flat?</div>
      <div style="color:${A.muted};font-size:15px">The answer changes which tools come first. You’ll only get one question per search.</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px"><button class="pill">A one-off trip</button><button class="pill">Ongoing, like a flat</button><button class="pill">Both</button><button class="ghost" style="height:44px">Skip, show me everything</button></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:28px;padding:6px;opacity:.6">${skeletonCard(200)}${skeletonCard(280)}${skeletonCard(360)}</div>
  </div></div>
</main>
${chatInput('Or just type the answer here')}
</div>`);
files['ResultsLoading.dc.html'] = page(`<div style="min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header()}
<main style="max-width:1280px;margin:0 auto;padding:8px 56px 40px;display:flex;flex-direction:column;gap:26px;width:100%">
  ${userBubble(QUERY)}
  <div style="display:flex;gap:16px;align-items:flex-start"><span style="display:inline-block;animation:bob 1.4s ease-in-out infinite">${mark(40)}</span><div style="flex:1;display:flex;flex-direction:column;gap:22px;min-width:0">
    <div style="display:flex;align-items:center;gap:14px;padding-top:8px"><span style="width:22px;height:22px;border-radius:50%;border:3px solid ${A.rule};border-top-color:${A.coral};animation:spin .9s linear infinite;flex:none"></span><span class="disp" style="font-size:22px;font-weight:700">Matching against 4,212 tools…</span><span style="color:${A.faint};font-size:14px">Read your request · found 14 candidates · checking Free and Spanish</span></div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center"><span style="font-weight:600;color:${A.muted};margin-right:6px">Here’s what I understood</span>${['Free', 'Spanish', 'Mobile', 'Trips'].map((l, i) => `<span class="pill sm flat" style="opacity:${1 - i * .18};border-style:dashed;color:${A.faint}">${l}</span>`).join('')}</div>
    <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:28px;padding:6px">${skeletonCard(100)}${skeletonCard(190)}${skeletonCard(280)}</div>
  </div></div>
</main>
${chatInput()}
</div>`);
files['ResultsEmpty.dc.html'] = page(`<div style="min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header()}
<main style="max-width:1280px;margin:0 auto;padding:8px 56px 40px;display:flex;flex-direction:column;gap:26px;width:100%">
  ${userBubble('A free expense splitter that works fully offline, needs no account, and has an Icelandic interface')}
  <div style="display:flex;gap:16px;align-items:flex-start">${mark(40)}<div style="flex:1;display:flex;flex-direction:column;gap:22px;min-width:0">
    ${understood([['Free', false], ['Icelandic', false], ['Offline', false], ['No account', false]])}
    <div class="slab rise" style="padding:32px 34px;display:flex;flex-direction:column;gap:18px;max-width:820px;box-shadow:6px 6px 0 ${A.ink};animation-delay:120ms">
      <div class="disp" style="font-size:34px;font-weight:800;line-height:1.05">We don’t have a good answer for this yet.</div>
      <div style="font-size:16.5px;line-height:1.55;color:${A.muted}">Foundit only recommends tools people can stand behind, and nothing in our database fits all four: <strong style="color:${A.ink};font-weight:600">free, Icelandic, offline, no account</strong>. 14 tools solve the problem itself; each misses at least one.</div>
      <div style="display:flex;flex-direction:column;gap:10px;background:${A.tint};border-radius:14px;padding:16px 18px">
        <div style="font-weight:600;font-size:14.5px">Closest we found, if you loosen one constraint</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px"><button class="pill sm">Drop Icelandic <span style="color:${A.muted};font-weight:500">· 3 tools</span></button><button class="pill sm">Drop offline <span style="color:${A.muted};font-weight:500">· 2 tools</span></button><button class="pill sm">Drop no account <span style="color:${A.muted};font-weight:500">· 5 tools</span></button></div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center"><button class="btn btn-coral">Know a tool that fits? Add it</button><div class="field" style="height:48px;width:260px"><span class="ph">you@example.com</span></div><button class="btn btn-sm">Email me if this changes</button></div>
    </div>
  </div></div>
</main>
${chatInput('Loosen it here, e.g. “English is fine” or “an account is OK”')}
</div>`);

// =====================================================================================
// 18. Browse problems + 19. Top tools
// =====================================================================================
const PROBLEMS = [['Remove background noise from a voice recording', 31, 'Audio'], ['Sign a PDF on my phone without paying', 18, 'Documents'], ['Split a restaurant bill unevenly', 12, 'Money'], ['Back up photos without Google or Apple', 24, 'Photos'], ['Turn a long meeting recording into notes', 27, 'Writing'], ['Block distracting websites during work hours', 15, 'Focus'], ['Share large video files with someone who has no account', 9, 'Files'], ['Learn Spanish vocabulary with spaced repetition', 7, 'Study'], ['Track a habit without an account', 11, 'Habits'], ['Keep a shared grocery list that works offline', 8, 'Home'], ['Convert a scanned book into searchable text', 14, 'Documents'], ['Merge two calendars into one view', 6, 'Time']];
files['BrowseProblems.dc.html'] = page(`<div style="min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header({ active: 'browse' })}
<main style="max-width:1280px;margin:0 auto;padding:32px 56px 80px;width:100%;display:flex;flex-direction:column;gap:28px">
  <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:24px"><div><h1 class="disp" style="font-size:54px;margin:0 0 10px">Problems people solve here</h1><div style="color:${A.muted};font-size:17px">4,212 tools, indexed by 11,480 problems written in plain language. Pick one to see what fits.</div></div><div class="field" style="width:340px;height:50px">${svg(P.search, 18, A.faint)}<span class="ph">Search problems</span></div></div>
  <div style="display:flex;flex-wrap:wrap;gap:10px">${['All', 'Money', 'Audio', 'Photos', 'Documents', 'Writing', 'Focus', 'Files', 'Study', 'Habits', 'Home', 'Privacy', 'Time'].map((c, i) => `<button class="pill sm ${i === 0 ? 'on' : 'flat'}">${c}</button>`).join('')}</div>
  <div style="display:grid;grid-template-columns:minmax(0, 1fr) 340px;gap:40px;align-items:start">
    <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:18px">
      ${PROBLEMS.map(([q, n, c], i) => `<a href="#" class="card hov rise" style="padding:22px 24px;display:flex;flex-direction:column;gap:14px;color:${A.ink};text-decoration:none;animation-delay:${i * 40}ms;box-shadow:4px 4px 0 ${A.ink}"><span class="disp" style="font-size:22px;font-weight:700;line-height:1.15">${q}</span><span style="display:flex;justify-content:space-between;align-items:center;font-size:13.5px;color:${A.muted}"><span class="tag">${c}</span><span class="tab">${n} tools ${svg(P.arrow, 14, A.violet, 2.25)}</span></span></a>`).join('')}
    </div>
    <aside style="display:flex;flex-direction:column;gap:18px;position:sticky;top:24px">
      <div class="slab" style="padding:22px;display:flex;flex-direction:column;gap:12px;box-shadow:6px 6px 0 ${A.lime}"><div class="h3">Trending this week</div>${[['Sign a PDF on my phone without paying', '+140%'], ['Turn a long meeting recording into notes', '+62%'], ['Back up photos without Google or Apple', '+38%']].map(([q, d]) => `<a href="#" style="display:flex;justify-content:space-between;gap:12px;font-size:14.5px;color:${A.ink};padding:8px 0;border-top:2px solid ${A.rule}"><span>${q}</span><span class="tab" style="color:${A.violet};font-weight:700;white-space:nowrap">${d}</span></a>`).join('')}</div>
      <div class="panel" style="padding:22px;display:flex;flex-direction:column;gap:10px"><div class="h3" style="font-size:18px">Don’t see yours?</div><div style="font-size:14.5px;color:${A.muted};line-height:1.5">Describe it in your own words. Most problems here started as a search.</div><a href="#" class="btn btn-sm btn-coral" style="text-decoration:none;color:#fff;align-self:flex-start">Describe a problem</a></div>
    </aside>
  </div>
</main>
${footer()}
</div>`);
files['TopTools.dc.html'] = page(`<div style="min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header()}
<main style="max-width:1280px;margin:0 auto;padding:32px 56px 80px;width:100%;display:flex;flex-direction:column;gap:26px">
  <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:24px"><div><h1 class="disp" style="font-size:54px;margin:0 0 10px">Top tools</h1><div style="color:${A.muted};font-size:17px">Ranked by likes, saves and how often they solve what people ask. No paid placement.</div></div><div style="display:flex;gap:8px"><button class="pill sm on">This month</button><button class="pill sm flat">All time</button></div></div>
  <div style="display:flex;flex-wrap:wrap;gap:10px">${['All', 'Money', 'Audio', 'Photos', 'Documents', 'Writing', 'Privacy', 'Habits', 'Study'].map((c, i) => `<button class="pill sm ${i === 0 ? 'on' : 'flat'}">${c}</button>`).join('')}</div>
  <div class="panel" style="overflow:hidden">
    ${TOP.map((t, i) => `<a href="#" class="rise" style="display:grid;grid-template-columns:44px 56px minmax(0, 1fr) 120px 220px 120px;gap:16px;align-items:center;padding:16px 26px;color:${A.ink};text-decoration:none;${i ? `border-top:2px solid ${A.rule};` : ''}animation-delay:${i * 40}ms">
      <span class="disp tab" style="font-size:28px;font-weight:800;color:${i < 3 ? A.coral : A.faint}">${i + 1}</span>${tile(t.k, 52)}
      <span><span class="disp" style="font-size:22px;font-weight:700;display:block">${t.name}</span><span style="font-size:14px;color:${A.muted}">${t.s}</span></span>
      <span class="tag">${t.cat}</span>
      <span class="tab" style="display:flex;gap:16px;font-size:14px;color:${A.muted}"><span style="display:inline-flex;align-items:center;gap:5px">${svg(P.heart, 15, A.coral, 2.25)}${t.likes}</span><span style="display:inline-flex;align-items:center;gap:5px">${svg(P.bookmark, 15, A.violet, 2.25)}${t.saves}</span></span>
      <span style="display:flex;justify-content:flex-end"><span class="btn btn-xs">${svg(P.bookmark, 15)}Save</span></span>
    </a>`).join('')}
  </div>
</main>
${footer()}
</div>`);

// =====================================================================================
// 20-25. Add a tool: relationship, URL (duplicate found), details, constraints, preview, success
// =====================================================================================
const submitShell = (cur, inner, h = 1040, right = 'Draft saved, continue anytime') => page(`<div style="min-height:${h}px;background:${A.bg};display:flex;flex-direction:column">
${header({ active: 'add', signedIn: true })}
<div style="padding:8px 56px 26px;display:grid;grid-template-columns:200px minmax(0, 1fr) 220px;align-items:center">
  <a href="#" class="ghost" style="justify-self:start">${svg(P.back, 16)}Back</a>
  <div style="display:flex;align-items:center;justify-content:center">${steps(cur)}</div>
  <div style="text-align:right;font-size:13.5px;color:${A.muted};display:flex;justify-content:flex-end;align-items:center;gap:6px;font-weight:500">${right ? svg(P.check, 14, A.violet, 2.5) + right : ''}</div>
</div>
${inner}
</div>`);
const radioCard = (on, title, body, extra = '') => `<label class="card hov" style="padding:24px;display:flex;gap:16px;align-items:flex-start;cursor:pointer;${on ? `background:${A.tint};` : ''}"><span class="radio${on ? ' on' : ''}" style="margin-top:2px"></span><span style="display:flex;flex-direction:column;gap:6px"><span class="disp" style="font-size:22px;font-weight:700">${title}</span><span style="color:${A.muted};font-size:15px;line-height:1.5">${body}</span>${extra}</span></label>`;
files['SubmitRelationship.dc.html'] = submitShell(0, `<main style="max-width:720px;margin:0 auto;padding:36px 24px 80px;width:100%;display:flex;flex-direction:column;gap:26px">
  <div><div style="font-size:14px;font-weight:600;color:${A.muted};margin-bottom:10px">Before we start</div><h1 class="disp" style="font-size:46px;margin:0 0 12px">Did you make this tool?</h1><p style="margin:0;font-size:17px;color:${A.muted};line-height:1.55">For now you can only add tools you built yourself. Everything else here we added at launch.</p></div>
  <label class="card hov" style="padding:24px;display:flex;gap:16px;align-items:flex-start;cursor:pointer">
    ${checkbox(false)}
    <span style="display:flex;flex-direction:column;gap:8px">
      <span class="disp" style="font-size:22px;font-weight:700">Yes, I made this tool</span>
      <span style="color:${A.muted};font-size:15px;line-height:1.5">The listing stays yours: edit it whenever the tool changes, and watch which searches bring people to it.</span>
    </span>
  </label>
  <div style="display:flex;justify-content:flex-end;padding-top:4px">
    <button class="btn" disabled style="padding:0 26px">Continue ${svg(P.arrow, 18, A.faint, 2.25)}</button>
  </div>
  <div style="font-size:14.5px;color:${A.faint};line-height:1.55;border-top:2px solid ${A.rule};padding-top:18px">Found something great that somebody else made? <a href="#">Tell us about it</a> — we add the good ones ourselves.</div>
</main>`, 1000, '');
files['SubmitURL.dc.html'] = submitShell(0, `<main style="max-width:720px;margin:0 auto;padding:36px 24px 80px;width:100%;display:flex;flex-direction:column;gap:28px">
  <div><div style="font-size:14px;font-weight:600;color:${A.muted};margin-bottom:10px">Step 1 of 5</div><h1 class="disp" style="font-size:46px;margin:0 0 12px">Where does it live?</h1><p style="margin:0;font-size:17px;color:${A.muted};line-height:1.55">A homepage, an App Store page, or a GitHub repo all work. We’ll read the page and fill in what we can.</p></div>
  <div style="display:flex;gap:10px"><div class="field" style="flex:1;height:56px;font-size:17px">https://www.splitwise.com</div><button class="btn btn-coral">Read the page</button></div>
  <div class="slab rise" style="padding:24px 26px;display:flex;flex-direction:column;gap:16px;box-shadow:6px 6px 0 ${A.amber}">
    <div style="display:flex;gap:16px;align-items:center">${tile('splitwise', 56)}<div><div class="disp" style="font-size:24px;font-weight:800">We already list Splitwise.</div><div style="color:${A.muted};font-size:15px">Added at launch, last updated 12 Aug 2026. 812 ratings.</div></div></div>
    <div style="color:${A.muted};font-size:15px;line-height:1.5">If something on that listing is wrong or out of date, suggesting an edit gets it fixed faster than a new submission.</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px"><a href="#" class="btn btn-sm" style="text-decoration:none;color:${A.ink}">View listing ${svg(P.external, 15)}</a><a href="#" class="btn btn-sm btn-violet" style="text-decoration:none;color:#fff">${svg(P.shield, 15, '#fff')}Claim it instead</a><button class="ghost" style="height:42px">This is a different tool</button></div>
  </div>
</main>`, 1000);
const shotThumb = (cap) => `<div style="width:120px;height:120px;border-radius:14px;background:${A.sunk};border:2px solid ${A.ink};display:flex;align-items:center;justify-content:center;position:relative">${svg(P.image, 24, A.faint)}<span style="position:absolute;bottom:6px;left:6px;right:6px;font-size:11px;color:${A.muted};text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cap}</span></div>`;
files['SubmitDetails.dc.html'] = submitShell(1, `<main style="max-width:720px;margin:0 auto;padding:36px 24px 80px;width:100%;display:flex;flex-direction:column;gap:26px">
  <div><div style="font-size:14px;font-weight:600;color:${A.muted};margin-bottom:10px">Step 2 of 5 · from receiptly.app</div><h1 class="disp" style="font-size:46px;margin:0 0 12px">Check the basics.</h1><p style="margin:0;font-size:17px;color:${A.muted};line-height:1.55">We pulled these from the page. Fix anything that’s off.</p></div>
  <div style="display:flex;gap:20px;align-items:center"><div style="display:flex;flex-direction:column;gap:8px;align-items:center">${tile('receiptly', 84)}<button class="ghost" style="font-size:13px">Replace icon</button></div><div style="flex:1;display:flex;flex-direction:column;gap:16px"><div style="display:flex;flex-direction:column;gap:8px"><label style="font-size:14px;font-weight:600">Name</label><div class="field">Receiptly</div></div><div style="display:flex;flex-direction:column;gap:8px"><label style="font-size:14px;font-weight:600;display:flex;justify-content:space-between">One-line summary <span class="tab" style="color:${A.faint};font-weight:500">66 / 120</span></label><div class="field area" style="min-height:64px">Photographs a receipt and splits line items between named people.</div><div style="font-size:13.5px;color:${A.muted}">Say what it does, not why it’s great. “Splits shared expenses across a group” beats “the #1 expense app”.</div></div></div></div>
  <div style="display:flex;flex-direction:column;gap:10px"><label style="font-size:14px;font-weight:600">Screenshots <span style="color:${A.faint};font-weight:500">up to 6</span></label><div style="display:flex;gap:12px;flex-wrap:wrap">${shotThumb('Scan')}${shotThumb('Assign items')}<div style="width:120px;height:120px;border-radius:14px;border:2px dashed ${A.ink};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:${A.muted};font-size:13px;font-weight:600">${svg(P.plus, 20, A.ink, 2.5)}Drop or click</div></div></div>
  <div style="display:flex;flex-direction:column;gap:8px"><label style="font-size:14px;font-weight:600">Category</label><div class="field" style="width:320px;justify-content:space-between">Money and expenses ${svg(P.chevron, 16, A.muted)}</div></div>
  <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px"><button class="ghost" style="height:44px">Back</button><button class="btn btn-coral" style="padding:0 26px">Continue to problems ${svg(P.arrow, 18, '#fff', 2.25)}</button></div>
</main>`, 1140);
const chipGroup = (title, items, help = '') => `<div style="display:flex;flex-direction:column;gap:10px"><div style="font-size:14px;font-weight:600;display:flex;justify-content:space-between"><span>${title}</span>${help ? `<span style="color:${A.faint};font-weight:500">${help}</span>` : ''}</div><div style="display:flex;flex-wrap:wrap;gap:8px">${items.map(([l, on]) => `<button class="pill sm ${on ? 'on' : 'flat'}">${on ? svg(P.check, 13, '#fff', 3) : ''}${l}</button>`).join('')}</div></div>`;
files['SubmitConstraints.dc.html'] = submitShell(3, `<main style="max-width:720px;margin:0 auto;padding:36px 24px 80px;width:100%;display:flex;flex-direction:column;gap:26px">
  <div><div style="font-size:14px;font-weight:600;color:${A.muted};margin-bottom:10px">Step 4 of 5 · Receiptly</div><h1 class="disp" style="font-size:46px;margin:0 0 12px">What’s true about it today?</h1><p style="margin:0;font-size:17px;color:${A.muted};line-height:1.55">These are the constraints people search with. Only tick what’s true today. People will tell you fast if something is off.</p></div>
  ${chipGroup('Price', [['Free', 1], ['Freemium', 0], ['Paid', 0], ['One-time purchase', 0], ['Open-source', 0]])}
  ${chipGroup('Platforms', [['iOS', 1], ['Android', 1], ['Web', 0], ['macOS', 0], ['Windows', 0], ['Linux', 0]])}
  <div style="display:flex;flex-direction:column;gap:10px"><div style="font-size:14px;font-weight:600">Languages <span style="color:${A.faint};font-weight:500">full interface only; partial support goes in the notes</span></div><div class="field area" style="min-height:56px;padding:8px 10px;gap:8px;flex-wrap:wrap;flex-direction:row;align-items:center"><span class="pill sm on">English ${svg(P.x, 13, '#fff')}</span><span class="pill sm on">Spanish ${svg(P.x, 13, '#fff')}</span><span class="pill sm on">Portuguese ${svg(P.x, 13, '#fff')}</span><span class="ph" style="padding:0 6px">Type to add a language</span></div></div>
  ${chipGroup('Works offline', [['Fully', 0], ['Partly, syncs later', 1], ['Needs a connection', 0]])}
  ${chipGroup('Account', [['No account needed', 1], ['Optional', 0], ['Required', 0]])}
  <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px"><button class="ghost" style="height:44px">Back</button><button class="btn btn-coral" style="padding:0 26px">Preview the listing ${svg(P.arrow, 18, '#fff', 2.25)}</button></div>
</main>`, 1300);
files['SubmitPreview.dc.html'] = submitShell(4, `<main style="max-width:840px;margin:0 auto;padding:36px 24px 80px;width:100%;display:flex;flex-direction:column;gap:26px">
  <div><div style="font-size:14px;font-weight:600;color:${A.muted};margin-bottom:10px">Step 5 of 5 · Receiptly</div><h1 class="disp" style="font-size:46px;margin:0 0 12px">This is how it will appear.</h1><p style="margin:0;font-size:17px;color:${A.muted};line-height:1.55">Exactly what someone sees when Receiptly shows up in their results. Anything off? Go back and fix it.</p></div>
  <article class="card rise" style="padding:30px 32px;display:flex;flex-direction:column;gap:20px">
    ${meter(88, 'example fit for “split a restaurant bill unevenly”')}
    <div style="display:flex;gap:16px;align-items:center">${tile('receiptly', 60)}<div style="flex:1"><div class="disp" style="font-size:34px;font-weight:800">Receiptly</div><div style="color:${A.muted};font-size:16px">Photographs a receipt and splits line items between named people.</div></div></div>
    <div class="why" style="font-size:17px"><b>Why it matches.</b> Built for splitting a restaurant bill when everyone ordered different things, with no account needed and a full Spanish interface.</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px"><span class="sat">${svg(P.check, 14, 'currentColor', 2.25)}Free</span><span class="sat">${svg(P.check, 14, 'currentColor', 2.25)}No account</span><span class="sat">${svg(P.check, 14, 'currentColor', 2.25)}Spanish, full interface</span><span class="sat">${svg(P.check, 14, 'currentColor', 2.25)}iOS and Android</span><span class="sat unmet">${svg(P.dash, 14, 'currentColor', 2.25)}Partly offline</span></div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding-top:4px"><span style="font-size:14px;color:${A.faint}">No ratings yet</span><div style="display:flex;gap:8px"><span class="btn btn-sm">${svg(P.bookmark, 16)}Save</span><span class="btn btn-sm btn-coral" style="color:#fff">Open Receiptly ${svg(P.external, 16, '#fff')}</span></div></div>
  </article>
  <div class="panel" style="padding:18px 22px;display:flex;flex-direction:column;gap:8px;font-size:14.5px"><div style="font-weight:600">Problems it solves</div>${['Splitting a restaurant bill when everyone ordered different things and nobody wants to do the maths', 'Keeping track of shared groceries in a flat by photographing the receipt'].map(p => `<div style="display:flex;gap:10px;align-items:flex-start;color:${A.ink}">${svg(P.check, 16, A.violet, 2.5, 'margin-top:3px')}${p}</div>`).join('')}</div>
  <label style="display:flex;gap:12px;align-items:center;font-size:15.5px;font-weight:500">${checkbox(true)}I’ve checked these details are accurate.</label>
  <div style="display:flex;justify-content:space-between;align-items:center;padding-top:4px"><button class="ghost" style="height:44px">Back</button><div style="display:flex;align-items:center;gap:16px"><span style="font-size:13.5px;color:${A.muted}">Goes live as soon as you publish. You can edit it any time.</span><button class="btn btn-coral" style="padding:0 26px">Publish it</button></div></div>
</main>`, 1240);
files['SubmitSuccess.dc.html'] = page(`<div style="height:900px;background:${A.bg};display:flex;flex-direction:column;position:relative;overflow:hidden">
${header({ active: 'add', signedIn: true })}
${[[12, 18, A.coral], [22, 40, A.violet], [76, 22, A.lime], [84, 48, A.coral], [30, 70, A.lime], [66, 78, A.violet], [50, 12, A.amber], [92, 80, A.amber]].map(([x, y, c], i) => `<span style="position:absolute;left:${x}%;top:${y}%;width:${14 + (i % 3) * 6}px;height:${14 + (i % 3) * 6}px;border-radius:${i % 2 ? '50%' : '4px'};background:${c};border:2px solid ${A.ink};animation:bob ${2 + i * .3}s ease-in-out ${i * .2}s infinite;pointer-events:none"></span>`).join('')}
<main style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;text-align:center;position:relative;padding-bottom:60px">
  <div class="rise">${mark(96)}</div>
  <h1 class="disp rise" style="font-size:56px;margin:0;max-width:640px;animation-delay:100ms">Receiptly is live.</h1>
  <p class="rise" style="margin:0;font-size:18px;color:${A.muted};max-width:520px;line-height:1.5;animation-delay:180ms">It’s searchable now, and the listing is yours to keep up to date. Two problem statements are in; add a third any time to reach more searches.</p>
  <div class="rise" style="display:flex;gap:12px;animation-delay:260ms"><button class="btn">Add another</button><button class="btn btn-coral">See the listing ${svg(P.arrow, 18, "#fff", 2.25)}</button></div>
</main>
</div>`);

// =====================================================================================
// 26-28. Saved: empty, share modal, public collection
// =====================================================================================
files['SavedEmpty.dc.html'] = page(`<div style="height:900px;background:${A.bg};display:flex;flex-direction:column">
${header({ active: 'saved', signedIn: true })}
<main style="max-width:1280px;margin:0 auto;padding:24px 56px 80px;width:100%;display:grid;grid-template-columns:240px minmax(0, 1fr);gap:48px;align-items:start;flex:1">
  <nav style="display:flex;flex-direction:column;gap:6px"><div class="disp" style="font-size:22px;font-weight:700;padding:0 12px 12px">Collections</div><a href="#" style="display:flex;justify-content:space-between;padding:10px 12px;border-radius:12px;font-size:15px;color:${A.ink};background:${A.tint};font-weight:700;text-decoration:none;border:2px solid ${A.ink}">All saved<span class="tab" style="color:${A.muted};font-weight:500">0</span></a><button class="ghost" style="justify-content:flex-start;margin-top:8px;color:${A.violet};font-weight:600">${svg(P.plus, 16, 'currentColor', 2.5)}New collection</button></nav>
  <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;text-align:center;padding:80px 0">
    <div class="slab rise" style="width:120px;height:120px;display:flex;align-items:center;justify-content:center;border-radius:28px;box-shadow:6px 6px 0 ${A.coral};transform:rotate(-4deg)">${svg(P.bookmark, 52, A.violet, 2)}</div>
    <h1 class="disp rise" style="font-size:40px;margin:0;animation-delay:100ms">Nothing saved yet.</h1>
    <p class="rise" style="margin:0;color:${A.muted};font-size:17px;max-width:420px;line-height:1.5;animation-delay:160ms">Tap Save on any result to keep it here, add a note, and sort tools into collections.</p>
    <button class="btn btn-coral rise" style="animation-delay:220ms">Start a search</button>
  </div>
</main>
</div>`);
const savedDimmed = `<div style="opacity:.5;pointer-events:none;max-width:1280px;margin:0 auto;padding:24px 56px;display:flex;flex-direction:column;gap:20px"><h1 class="disp" style="font-size:46px;margin:0">Trip planning</h1><div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:26px;padding:6px">${savedCard({ k: 'splitwise', name: 'Splitwise', summary: 'Splits shared expenses across a group.', tags: ['Free', 'Spanish'], note: 'Default choice.', rot: '0deg' })}${savedCard({ k: 'tricount', name: 'Tricount', summary: 'Group expense tracking without an account.', tags: ['Free', 'No account'], note: 'Backup.', rot: '0deg' })}</div></div>`;
files['ShareCollection.dc.html'] = page(`<div style="height:900px;background:${A.bg};position:relative;overflow:hidden">
${header({ active: 'saved', signedIn: true })}
${savedDimmed}
<div style="position:absolute;inset:0;background:rgba(28,26,36,.45);display:flex;align-items:center;justify-content:center">
  <div role="dialog" class="rise" style="width:520px;background:${A.surface};border:2px solid ${A.ink};border-radius:24px;box-shadow:10px 10px 0 ${A.violet};padding:30px 34px 26px;display:flex;flex-direction:column;gap:18px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start"><div><h1 class="disp" style="font-size:30px;margin:0">Share “Trip planning”</h1><div style="color:${A.muted};font-size:14.5px;margin-top:4px">4 tools, with your notes</div></div><button class="ghost" style="padding:0 8px;margin:-6px -12px 0 0" aria-label="Close">${svg(P.x, 20)}</button></div>
    <label style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 16px;border:2px solid ${A.ink};border-radius:14px"><span><span style="font-weight:600;display:block">Anyone with the link can view</span><span style="font-size:13.5px;color:${A.muted}">Off means only you. Nobody can edit either way.</span></span><span class="toggle on"></span></label>
    <div style="display:flex;gap:8px"><div class="field" style="flex:1;font-size:14.5px;color:${A.muted}">foundit.app/c/noa/trip-planning</div><button class="btn btn-violet">Copy link</button></div>
    <div style="font-size:13.5px;color:${A.muted};line-height:1.5;background:${A.tint};padding:12px 14px;border-radius:12px">Shared collections are read-only. Your notes are included, so remove any you’d rather keep private before sharing.</div>
  </div>
</div>
</div>`);
files['PublicCollection.dc.html'] = page(`<div style="min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header()}
<main style="max-width:1100px;margin:0 auto;padding:36px 56px 80px;width:100%;display:flex;flex-direction:column;gap:26px">
  <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:24px">
    <div><div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">${avatar('N', 36, '#DCEBE3', '#1F5A48')}<span style="font-size:15px;color:${A.muted}">A collection by <strong style="color:${A.ink};font-weight:600">@noa</strong> · updated 3 days ago</span></div><h1 class="disp" style="font-size:54px;margin:0 0 8px">Trip planning</h1><div style="color:${A.muted};font-size:17px">Options for the Greece trip in October · 4 tools</div></div>
    <div style="display:flex;gap:8px"><button class="btn btn-sm">${svg(P.share, 16)}Share</button><button class="btn btn-sm btn-coral">${svg(P.dup, 16, '#fff')}Save a copy</button></div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:26px;padding:6px">
    ${savedCard({ k: 'splitwise', name: 'Splitwise', summary: 'Splits shared expenses across a group and tells everyone who owes what.', tags: ['Free', 'Spanish', 'iOS and Android'], note: 'Default choice, everyone already has it. Ads on free are tolerable.', rot: '-0.7deg' })}
    ${savedCard({ k: 'tricount', name: 'Tricount', summary: 'Group expense tracking without creating an account.', tags: ['Free', 'Spanish', 'No account'], note: 'Backup if Dana refuses to make an account.', rot: '0.6deg' })}
    ${savedCard({ k: 'settleup', name: 'Settle Up', summary: 'Shared expenses with offline entry and later sync.', tags: ['Free tier', 'Works offline'], note: 'For the boat day with no signal.', rot: '0.5deg' })}
    ${savedCard({ k: 'receiptly', name: 'Receiptly', summary: 'Photographs a receipt and splits line items between named people.', tags: ['Free', 'Spanish', 'iOS and Android'], note: 'For the restaurant nights specifically.', rot: '-0.5deg' })}
  </div>
  <div class="slab" style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding:22px 28px;box-shadow:6px 6px 0 ${A.lime}"><div><div class="disp" style="font-size:24px;font-weight:800">Want your own copy?</div><div style="color:${A.muted};margin-top:4px">Save it to your account and add your own notes. Free, about five seconds.</div></div><button class="btn btn-coral">Save a copy</button></div>
</main>
${footer()}
</div>`);

// =====================================================================================
// 29-30. Tool detail extras: change history, report modal
// =====================================================================================
files['ChangeHistory.dc.html'] = page(`<div style="min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header({ signedIn: true })}
<main style="max-width:960px;margin:0 auto;padding:16px 56px 80px;width:100%;display:flex;flex-direction:column;gap:24px">
  <div style="font-size:14px;color:${A.muted};display:flex;gap:8px;align-items:center"><a href="#" style="color:${A.muted}">Tricount</a>${svg(P.chevronR, 14, A.faint)}<span>Change history</span></div>
  <div style="display:flex;gap:18px;align-items:center">${tile('tricount', 64)}<div><h1 class="disp" style="font-size:42px;margin:0">Change history</h1><div style="color:${A.muted}">Every edit to Tricount, who made it, and who approved it.</div></div></div>
  <div class="panel" style="overflow:hidden">
    ${[['12 Aug 2026', 'noa', 'Languages, Pricing', 'marcus', true, false], ['3 Jun 2026', 'shira', 'Verified all constraint claims', '', false, false], ['20 Apr 2026', 'priya', 'Problems it solves (added 1)', 'marcus', true, false], ['2 Feb 2026', 'tomer', 'Offline capability', 'shira', true, true], ['14 Mar 2024', 'marcus', 'Listing created', '', false, false]].map(([d, who, what, by, diff, reverted], i) => `<div style="display:grid;grid-template-columns:130px minmax(0, 1fr) auto;gap:20px;align-items:center;padding:18px 24px;${i ? `border-top:2px solid ${A.rule}` : ''}">
      <span class="tab" style="font-size:14px;color:${A.muted};font-weight:500">${d}</span>
      <span style="font-size:15px;line-height:1.5"><strong style="font-weight:600">@${who}</strong> changed <strong style="font-weight:600">${what}</strong>${by ? ` <span style="color:${A.muted}">· approved by @${by}</span>` : ''}${reverted ? ` <span class="pillstat" style="background:${A.amber};color:${A.amberInk};height:22px;margin-left:6px">Reverted 4 Feb</span>` : ''}</span>
      <span style="display:flex;gap:6px">${diff ? `<a href="#" class="btn btn-xs" style="text-decoration:none;color:${A.ink}">View diff</a><button class="ghost" title="Trust level 3 only" style="color:${A.faint}">Revert</button>` : ''}</span>
    </div>`).join('')}
  </div>
  <div style="font-size:13.5px;color:${A.faint}">Reverts are limited to trusted reviewers and are themselves recorded here.</div>
</main>
</div>`);
files['ReportListing.dc.html'] = page(`<div style="height:900px;background:${A.bg};position:relative;overflow:hidden">
${header({ signedIn: true })}
<div style="padding:40px 56px;opacity:.5;max-width:1280px;margin:0 auto;display:flex;gap:22px;align-items:center">${tile('splitwise', 84)}<div><div class="disp" style="font-size:52px">Splitwise</div><div style="font-size:19px;color:${A.muted}">Splits shared expenses across a group and tells everyone who owes what.</div></div></div>
<div style="position:absolute;inset:0;background:rgba(28,26,36,.45);display:flex;align-items:center;justify-content:center">
  <div role="dialog" class="rise" style="width:520px;background:${A.surface};border:2px solid ${A.ink};border-radius:24px;box-shadow:10px 10px 0 ${A.amber};padding:30px 34px 26px;display:flex;flex-direction:column;gap:18px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start"><div><h1 class="disp" style="font-size:30px;margin:0">Report Splitwise</h1><div style="color:${A.muted};font-size:14.5px;margin-top:4px">Someone on the team reads every report. You won’t be named.</div></div><button class="ghost" style="padding:0 8px;margin:-6px -12px 0 0" aria-label="Close">${svg(P.x, 20)}</button></div>
    <div style="display:flex;flex-direction:column;gap:8px">${[['Something here is wrong or out of date', true], ['The link is dead or goes somewhere else', false], ['It’s spam or not really software', false], ['It’s a duplicate of another listing', false], ['Something else', false]].map(([l, on]) => `<label style="display:flex;gap:12px;align-items:center;padding:12px 14px;border:2px solid ${on ? A.ink : A.rule};border-radius:12px;font-size:15px;cursor:pointer;background:${on ? A.tint : 'transparent'}"><span class="radio${on ? ' on' : ''}"></span>${l}</label>`).join('')}</div>
    <div style="display:flex;flex-direction:column;gap:6px"><label style="font-size:14px;font-weight:600">What’s wrong? <span style="color:${A.faint};font-weight:500">optional but it helps</span></label><div class="field area" style="min-height:72px"><span class="ph">e.g. The free plan now caps groups at 3, see their pricing page.</span></div></div>
    <div style="display:flex;justify-content:flex-end;gap:10px"><button class="ghost" style="height:44px">Cancel</button><button class="btn btn-coral">Send report</button></div>
  </div>
</div>
</div>`);

// =====================================================================================
// 31-33. Review: edit diff, request changes, merge duplicate
// =====================================================================================
const reviewShell = (inner, listActive = 'edit') => `<div style="min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header({ signedIn: true })}
<div style="flex:1;display:grid;grid-template-columns:230px 330px minmax(0, 1fr);min-height:0;border-top:2px solid ${A.ink}">
  <nav style="border-right:2px solid ${A.ink};padding:24px 16px;display:flex;flex-direction:column;gap:6px">
    <div class="disp" style="font-size:22px;font-weight:700;padding:0 10px 12px">Review queue</div>
    ${[['New submissions', 12, listActive === 'new'], ['Edit suggestions', 7, listActive === 'edit'], ['Reported listings', 2, false], ['Duplicate candidates', 4, listActive === 'dup'], ['My claimed items', 1, false]].map(([l, n, on]) => `<a href="#" style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:12px;font-size:15px;color:${A.ink};background:${on ? A.tint : 'transparent'};font-weight:${on ? 700 : 500};text-decoration:none;border:2px solid ${on ? A.ink : 'transparent'}">${l}<span class="tab" style="font-size:13px;color:${A.muted}">${n}</span></a>`).join('')}
  </nav>
  <div style="border-right:2px solid ${A.ink};overflow:hidden;display:flex;flex-direction:column;background:${A.sunk}">
    <div style="padding:14px 18px;border-bottom:2px solid ${A.rule};display:flex;justify-content:space-between;align-items:center;font-size:14px"><span style="color:${A.muted};font-weight:500">${listActive === 'dup' ? '4 candidates' : '7 waiting, oldest 3d'}</span><span style="display:flex;align-items:center;gap:4px;font-weight:600">Oldest first ${svg(P.chevron, 14)}</span></div>
    ${listActive === 'dup' ? qItem({ name: 'Snapsplit → Splitwise?', who: '@tomer', lvl: 'New', age: '2d', flags: [['0.91 similar', true]], active: true }) + qItem({ name: 'Receiptly → Spliddit?', who: 'auto-flag', lvl: 'System', age: '4h', flags: [['0.74 similar', false]] }) : qItem({ name: 'Tricount', who: '@noa', lvl: 'Contributor', age: '2h', flags: [['3 changes', false], ['Pricing claim', true]], active: true, claimed: 'Being reviewed by you, 28 min left' }) + qItem({ name: 'Quiet Room', who: '@dev.itai', lvl: 'New', age: '1d', flags: [['1 change', false]] }) + qItem({ name: 'Ente', who: '@shira', lvl: 'Reviewer', age: '2d', flags: [['2 changes', false]] })}
  </div>
  ${inner}
</div>
</div>`;
const diffRow = (field, oldV, newV, on) => `<div style="display:grid;grid-template-columns:24px 150px minmax(0, 1fr) minmax(0, 1fr);gap:16px;align-items:start;padding:14px 0;border-top:2px solid ${A.rule}"><span style="padding-top:2px">${checkbox(on)}</span><span style="font-weight:600;font-size:14.5px">${field}</span><span style="font-size:14.5px;color:${A.faint};text-decoration:line-through">${oldV}</span><span style="font-size:14.5px;background:${A.tint};padding:4px 8px;border-radius:8px">${newV}</span></div>`;
files['EditDiffReview.dc.html'] = page(reviewShell(`<div style="display:flex;flex-direction:column;min-height:0">
    <div style="flex:1;overflow:hidden;padding:28px 36px;display:flex;flex-direction:column;gap:22px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px"><div style="display:flex;gap:16px;align-items:center">${tile('tricount', 60)}<div><h1 class="disp" style="font-size:34px;margin:0">@noa suggested 3 changes to Tricount</h1><div style="color:${A.muted};margin-top:2px">Submitted 2h ago · Contributor, 14 accepted edits</div></div></div><a href="#" class="btn btn-xs" style="text-decoration:none;color:${A.ink}">Open live site ${svg(P.external, 15)}</a></div>
      <div style="background:${A.tint};border:2px solid ${A.violet};border-radius:14px;padding:14px 18px;font-size:15px;line-height:1.5"><strong style="font-weight:600;color:${A.violet}">Why:</strong> Spanish UI shipped in v9.2 (see their changelog, 20 Aug). Premium price changed on their pricing page.</div>
      <div><div style="display:grid;grid-template-columns:24px 150px minmax(0, 1fr) minmax(0, 1fr);gap:16px;font-size:12.5px;font-weight:700;color:${A.muted};padding-bottom:8px"><span></span><span>Field</span><span>Before</span><span>After</span></div>
        ${diffRow('Languages', 'English, French, Spanish (partial)', 'English, French, Spanish (full interface)', true)}
        ${diffRow('Pricing · Premium', '$1.99 / mo', '$2.49 / mo', true)}
        ${diffRow('Offline', 'Needs a connection', 'Partial. Entries queue and sync when back online', false)}
      </div>
      <div style="font-size:14px;color:${A.muted}">Unchanged fields are collapsed. Tick the changes you accept; the rest go back to @noa with a note.</div>
    </div>
    <div style="border-top:2px solid ${A.ink};padding:16px 36px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:${A.surface}"><div style="display:flex;gap:10px"><button class="btn btn-sm btn-lime">Approve 2 selected</button><button class="btn btn-sm">Request changes</button></div><button class="btn btn-sm btn-danger">Reject all</button></div>
  </div>`));
files['RequestChanges.dc.html'] = page(`<div style="height:900px;background:${A.bg};position:relative;overflow:hidden">
${reviewShell(`<div style="padding:28px 36px;opacity:.5"><h1 class="disp" style="font-size:34px;margin:0">@noa suggested 3 changes to Tricount</h1></div>`)}
<div style="position:absolute;inset:0;background:rgba(28,26,36,.45);display:flex;align-items:center;justify-content:center">
  <div role="dialog" class="rise" style="width:560px;background:${A.surface};border:2px solid ${A.ink};border-radius:24px;box-shadow:10px 10px 0 ${A.amber};padding:30px 34px 26px;display:flex;flex-direction:column;gap:18px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start"><div><h1 class="disp" style="font-size:30px;margin:0">Ask @noa for changes</h1><div style="color:${A.muted};font-size:14.5px;margin-top:4px">Goes to them by email, with a link back to this edit.</div></div><button class="ghost" style="padding:0 8px;margin:-6px -12px 0 0" aria-label="Close">${svg(P.x, 20)}</button></div>
    <div style="display:flex;flex-direction:column;gap:8px"><label style="font-size:14px;font-weight:600">Reusable notes</label><div style="display:flex;flex-wrap:wrap;gap:8px">${['Please confirm the pricing with a screenshot', 'The summary reads like marketing copy', 'Confirm the language claim with a screenshot', 'Link a source for this change'].map((s, i) => `<button class="pill sm ${i === 0 ? 'on' : 'flat'}" style="height:34px;font-size:13.5px">${s}</button>`).join('')}</div></div>
    <div class="field area" style="min-height:120px;font-size:15px">Please confirm the pricing with a screenshot. The Premium price change looks right, but their pricing page shows $2.49 only for annual billing. Is monthly still $1.99?</div>
    <div style="display:flex;justify-content:flex-end;gap:10px"><button class="ghost" style="height:44px">Cancel</button><button class="btn btn-coral">Send and unclaim</button></div>
  </div>
</div>
</div>`);
const mergeRow = (field, l, r, pick) => `<div style="display:grid;grid-template-columns:140px minmax(0, 1fr) minmax(0, 1fr) 150px;gap:14px;align-items:center;padding:12px 0;border-top:2px solid ${A.rule};font-size:14.5px"><span style="font-weight:600">${field}</span><span style="padding:8px 10px;border-radius:10px;border:2px solid ${pick === 'l' ? A.violet : A.rule};background:${pick === 'l' ? A.tint : 'transparent'}">${l}</span><span style="padding:8px 10px;border-radius:10px;border:2px solid ${pick === 'r' ? A.violet : A.rule};background:${pick === 'r' ? A.tint : 'transparent'}">${r}</span><span style="display:flex;gap:4px;justify-content:flex-end">${['l', 'r', 'b'].map(k => `<span class="pill sm flat" style="height:30px;padding:0 10px;font-size:12.5px;${pick === k ? `background:${A.violet};color:#fff;border-color:${A.violet}` : ''}">${k === 'l' ? 'Left' : k === 'r' ? 'Right' : 'Both'}</span>`).join('')}</span></div>`;
files['MergeDuplicate.dc.html'] = page(reviewShell(`<div style="display:flex;flex-direction:column;min-height:0">
    <div style="flex:1;overflow:hidden;padding:28px 36px;display:flex;flex-direction:column;gap:22px">
      <div><h1 class="disp" style="font-size:34px;margin:0 0 6px">Merge Snapsplit into Splitwise?</h1><div style="color:${A.muted}">Same website, same maker, 0.91 similarity. Pick what to keep per field. Snapsplit’s URL will redirect to Splitwise.</div></div>
      <div style="display:grid;grid-template-columns:140px minmax(0, 1fr) minmax(0, 1fr) 150px;gap:14px;align-items:center;font-size:13px;font-weight:700;color:${A.muted}"><span></span><span style="display:flex;align-items:center;gap:8px">${tile('spliddit', 28)}Snapsplit <span style="font-weight:500">· new, @tomer</span></span><span style="display:flex;align-items:center;gap:8px">${tile('splitwise', 28)}Splitwise <span style="font-weight:500">· live since 2024</span></span><span style="text-align:right">Keep</span></div>
      ${mergeRow('Name', 'Snapsplit', 'Splitwise', 'r')}
      ${mergeRow('Summary', 'Snap a receipt, split the bill in seconds.', 'Splits shared expenses across a group and tells everyone who owes what.', 'r')}
      ${mergeRow('Problems', 'Splitting a restaurant bill from a photo of the receipt', '4 statements (trips, shared flats, currencies, running tabs)', 'b')}
      ${mergeRow('Screenshots', '2 images', '4 images', 'b')}
      ${mergeRow('Pricing', 'Free · Pro $4.99', 'Free · Pro $4.99 · Pro (EU) €4.49', 'r')}
      ${mergeRow('Languages', 'English, Spanish', 'English, Spanish, French, +9', 'r')}
      <div style="font-size:14px;color:${A.muted}">Ratings, likes and saves on Snapsplit (3 so far) move to Splitwise. @tomer is credited for the added problem statement.</div>
    </div>
    <div style="border-top:2px solid ${A.ink};padding:16px 36px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:${A.surface}"><div style="display:flex;gap:10px"><button class="btn btn-sm btn-violet">${svg(P.dup, 16, '#fff')}Merge into Splitwise</button><button class="btn btn-sm">Not a duplicate</button></div><button class="ghost">Cancel</button></div>
  </div>`, 'dup'));

// =====================================================================================
// 34. Public profile · 35. Error
// =====================================================================================
files['ProfilePublic.dc.html'] = page(`<div style="min-height:900px;background:${A.bg};display:flex;flex-direction:column">
${header()}
<div style="border-top:2px solid ${A.ink};border-bottom:2px solid ${A.ink};background:${A.tint}">
  <div style="max-width:1280px;margin:0 auto;padding:44px 56px 0;display:flex;flex-direction:column;gap:28px">
    <div style="display:flex;gap:24px;align-items:center">${avatar('P', 96, '#DFE6F2', '#2E4A7A')}<div style="display:flex;flex-direction:column;gap:6px"><div style="display:flex;align-items:center;gap:12px"><h1 class="disp" style="font-size:42px;margin:0">Priya Raman</h1><span class="pillstat" style="background:${A.coral};color:#fff;border:2px solid ${A.ink};height:28px;gap:6px">${svg(P.star, 14, '#fff', 2.5)}Founder · 24</span></div><div style="color:${A.muted};font-size:15px">@priya · Joined March 2025 · Madrid</div><div style="max-width:560px;line-height:1.5">Indie maker. I list the small tools I actually use, and I’m picky about “free” meaning free.</div><div style="font-size:15px;display:flex;align-items:center;gap:6px;font-weight:500">${svg(P.shield, 16, A.violet, 2.25)}Maker of <a href="#" style="font-weight:700">Receiptly</a></div></div></div>
    <div class="tab" style="display:flex;gap:40px;font-size:15px;color:${A.muted};padding-bottom:24px">${[['24', 'tools added'], ['1', 'tool maintained'], ['47', 'reviews'], ['3', 'public collections']].map(([n, l]) => `<div><strong class="disp" style="font-size:26px;color:${A.ink};font-weight:800">${n}</strong> ${l}</div>`).join('')}</div>
    <div style="display:flex;gap:6px">${['Tools added', 'Reviews', 'Collections'].map((t, i) => `<a href="#" style="padding:10px 16px;border:2px solid ${i === 0 ? A.ink : 'transparent'};border-bottom:0;border-radius:14px 14px 0 0;background:${i === 0 ? A.bg : 'transparent'};color:${A.ink};font-weight:${i === 0 ? 700 : 500};text-decoration:none;margin-bottom:-2px">${t}</a>`).join('')}</div>
  </div>
</div>
<main style="max-width:1280px;margin:0 auto;padding:28px 56px 80px;width:100%">
  <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:24px">
    ${[['receiptly', 'Receiptly', 'Photographs a receipt and splits line items between named people.', '520', '-0.6deg'], ['otter', 'Otter Notes', 'Turns a meeting recording into notes.', '980', '0.5deg'], ['habit', 'Habitual', 'Habit tracking that never asks for an account.', '410', '-0.4deg'], ['loops', 'Loops', 'One-tap habit tracking with streaks.', '870', '0.6deg'], ['ente', 'Ente', 'Photo backup without Google or Apple.', '1.6k', '-0.5deg'], ['vocab', 'Vocab', 'Spaced-repetition vocabulary in any language.', '640', '0.4deg']].map(([k, n, s, likes, rot]) => `<a href="#" class="card hov" style="padding:20px;display:flex;flex-direction:column;gap:12px;color:${A.ink};text-decoration:none"><div style="display:flex;align-items:center;gap:12px">${tile(k, 44)}<span class="disp" style="font-size:21px;font-weight:700">${n}</span></div><div style="font-size:14.5px;color:${A.muted};line-height:1.5">${s}</div><div style="font-size:13.5px;color:${A.muted};display:flex;align-items:center;gap:6px;margin-top:auto">${svg(P.heart, 14, A.coral, 2.25)}${likes}</div></a>`).join('')}
  </div>
</main>
</div>`);
files['ErrorPage.dc.html'] = page(`<div style="height:900px;background:${A.bg};display:flex;flex-direction:column">
${header()}
<main style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;text-align:center;padding-bottom:60px">
  <div class="slab rise" style="width:132px;height:132px;display:flex;align-items:center;justify-content:center;border-radius:30px;box-shadow:6px 6px 0 ${A.coral};transform:rotate(6deg)"><svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="${A.ink}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M4.9 19.1l2.2-2.2M16.9 7.1l2.2-2.2"/><path d="M15.5 8.5l-2 1.5" stroke="${A.coral}" stroke-width="2.4"/></svg></div>
  <h1 class="disp rise" style="font-size:48px;margin:0;animation-delay:100ms">Something broke on our side.</h1>
  <p class="rise" style="margin:0;color:${A.muted};font-size:18px;max-width:440px;line-height:1.5;animation-delay:160ms">Your search is safe. Try again in a moment, or go back and it’ll still be there.</p>
  <div class="rise" style="display:flex;gap:12px;animation-delay:220ms"><button class="btn">Go back</button><button class="btn btn-coral">Try again</button></div>
  <div style="font-size:13px;color:${A.faint}">Error 500 · ref 7f3a-2c</div>
</main>
</div>`);

for (const [name, html] of Object.entries(files)) writeFileSync(path.join(OUT, name), html);
console.log('wrote', Object.keys(files).length, 'artboards');
