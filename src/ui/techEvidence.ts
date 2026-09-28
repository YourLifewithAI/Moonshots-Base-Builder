/** The engineering notebook sits above the tree without changing research. */
import './techEvidence.css';
import { EVIDENCE, EVIDENCE_MATURITY_LABEL } from '../data/evidence';
import { TECHS, type TechId } from '../data/techs';
import type { ResearchCard } from '../core/research';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]!));

export function evidenceButton(tid: TechId): string {
  return EVIDENCE[tid] ? `<button class="btn evidence-open" data-act="evidence" data-tech="${tid}">Real engineering · sources ↗</button>` : '';
}

export function mountTechEvidence(root: HTMLElement) {
  const dialog = document.createElement('dialog');
  dialog.id = 'tech-evidence';
  dialog.className = 'interactive';
  dialog.setAttribute('aria-labelledby', 'evidence-title');
  root.appendChild(dialog);
  let active: TechId | null = null;
  let opener: HTMLElement | null = null;

  const update = (card: ResearchCard | undefined) => {
    if (!active || !card || card.tid !== active) return;
    const pilot = dialog.querySelector<HTMLElement>('.evidence-pilot');
    if (!pilot) return;
    pilot.hidden = !card.insight;
    if (!card.insight) return;
    const { hint, earned, discount } = card.insight;
    const status = earned ? 'Completed · discount earned' : card.state === 'done' ? 'Technology already researched' : 'Optional engineering pilot';
    const html = `<h3>${status}</h3><p>${esc(hint)}.</p><p class="evidence-reward">${Math.round(discount * 100)}% less research data${earned ? ' · saved with your base' : ' · earn through normal play'}.</p>`;
    if (pilot.innerHTML !== html) pilot.innerHTML = html;
  };
  const close = () => dialog.close();
  dialog.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-evidence-close]')) close();
  });
  dialog.addEventListener('close', () => {
    // Live research updates may replace the detail sheet while this is open.
    const current = active ? root.querySelector<HTMLElement>(`#tech-sheet-body .evidence-open[data-tech="${active}"]`) : null;
    const target = opener?.isConnected ? opener : current;
    active = null;
    target?.focus();
  });
  // Keep tree/camera shortcuts away from links and the scrollable notebook.
  dialog.addEventListener('keydown', (e) => e.stopPropagation());

  return {
    isOpen: () => dialog.open,
    close,
    update,
    show(tid: TechId, card: ResearchCard) {
      const evidence = EVIDENCE[tid];
      if (!evidence) return;
      active = tid;
      opener = document.activeElement as HTMLElement | null;
      dialog.innerHTML = `<header class="evidence-head"><div><div class="label">ENGINEERING NOTEBOOK</div>
        <h2 id="evidence-title">${esc(TECHS[tid].name)}</h2></div>
        <button class="btn" data-evidence-close aria-label="Close engineering notebook">Close ×</button></header>
        <div class="evidence-body">
          <section><h3>What exists today</h3><p>${esc(evidence.whatExists)}</p></section>
          <div class="evidence-sources">${evidence.sources.map((s) => `<article class="evidence-source">
            <div class="evidence-source-meta"><strong>${esc(s.company)}</strong><span>${esc(s.country)}</span>
              <span class="evidence-maturity">${esc(EVIDENCE_MATURITY_LABEL[s.maturity])}</span></div>
            <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} <span aria-hidden="true">↗</span></a>
            <small>Source checked ${esc(s.verified)} · opens in a new tab</small>
          </article>`).join('')}</div>
          <section><h3>The lunar engineering gap</h3><p>${esc(evidence.lunarGap)}</p></section>
          <section><h3>What the game simplifies</h3><p>${esc(evidence.abstraction)}</p></section>
          <section class="evidence-pilot" aria-live="polite"></section>
          <p class="evidence-foot">These are examples of work on the underlying technology. A terrestrial product or a demonstration does not establish a working lunar supply chain.</p>
        </div>`;
      update(card);
      if (!dialog.open) dialog.showModal();
      dialog.querySelector<HTMLButtonElement>('[data-evidence-close]')?.focus();
    },
  };
}
