/** Shared by the browser veil and the Hub preview. No story text enters this dialog. */
export function openRevealDialog(options: { onConfirm: () => void; returnFocus?: HTMLElement; onClose?: () => void }) {
  document.getElementById('unspoil-reveal-dialog')?.remove();
  const host = document.createElement('div');
  host.id = 'unspoil-reveal-dialog';
  host.className = 'unspoil-float';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{all:initial;position:fixed;inset:0;z-index:2147483647;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202720;color-scheme:light}
    *{box-sizing:border-box}.scrim{position:absolute;inset:0;display:grid;place-items:center;padding:24px;background:rgba(14,23,18,.42);backdrop-filter:blur(4px)}
    .dialog{width:min(420px,100%);padding:32px;border-radius:16px;background:#fffefb;box-shadow:0 24px 90px #0003;border:1px solid #e2e5dc}
    .label{font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:650;color:#66715e;margin:0 0 12px}h2{font-size:26px;line-height:1.2;letter-spacing:-.7px;margin:0 0 14px;font-weight:650}p{margin:0;color:#556051;font-size:16px}
    .actions{display:flex;gap:10px;margin-top:28px;flex-wrap:wrap}button{flex:1;min-height:46px;font-weight:600;line-height:1.4;font-family:inherit;font-size:15px;cursor:pointer;padding:12px 16px;border-radius:8px;border:1px solid #cfd5c8;color:#26372a;background:#fffefb;white-space:nowrap}button.confirm{background:#293f32;border-color:#293f32;color:#fff}button:hover{filter:brightness(.94)}button:focus-visible{outline:3px solid #819368;outline-offset:3px}
    @media(prefers-reduced-motion:no-preference){.dialog{animation:arrive .18s ease-out}@keyframes arrive{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}
  </style><div class="scrim"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="reveal-title" aria-describedby="reveal-description"><p class="label">Your choice</p><h2 id="reveal-title">Reveal this comment?</h2><p id="reveal-description">It may contain spoilers beyond where you’ve watched. Once you read it, you can’t unread it.</p><div class="actions"><button type="button" class="cancel">Keep it blurred</button><button type="button" class="confirm">Reveal comment</button></div></section></div>`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true; host.remove(); options.onClose?.();
    if (options.returnFocus?.isConnected) options.returnFocus.focus({preventScroll:true});
  };
  root.querySelector('.cancel')!.addEventListener('click', close);
  root.querySelector('.confirm')!.addEventListener('click', () => { close(); options.onConfirm(); });
  root.querySelector('.scrim')!.addEventListener('click', event => { if (event.target === event.currentTarget) close(); });
  root.addEventListener('keydown', event => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Tab') {
      event.preventDefault();
      const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
      const index = buttons.indexOf(root.activeElement as HTMLButtonElement);
      buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    }
  });
  document.documentElement.append(host);
  root.querySelector<HTMLButtonElement>('.cancel')!.focus();
  return close;
}
