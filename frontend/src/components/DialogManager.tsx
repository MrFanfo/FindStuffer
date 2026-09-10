import { useEffect } from "react";

const focusable = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const visibleControls = (dialog: HTMLElement) => Array.from(dialog.querySelectorAll<HTMLElement>(focusable)).filter((node) => node.getClientRects().length && !node.closest('[inert]'));

/** Shared keyboard and focus lifecycle for all modal surfaces, including nested pickers. */
export function DialogManager() {
  useEffect(() => {
    let stack: HTMLElement[] = [];
    const returnFocus = new Map<HTMLElement, HTMLElement | null>();
    const inerted = new Map<HTMLElement, boolean>();
    let previousOverflow = "";
    let lastFocus = document.activeElement as HTMLElement | null;
    const restoreInert = () => { inerted.forEach((value, node) => { node.inert = value; }); inerted.clear(); };
    const focusFirst = (dialog: HTMLElement) => {
      dialog.tabIndex = -1;
      (dialog.querySelector<HTMLElement>('[autofocus]') || visibleControls(dialog)[0] || dialog).focus();
    };
    const update = () => {
      const next = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'));
      if (next.length === stack.length && next.every((node, index) => node === stack[index])) return;
      restoreInert();
      const oldTop = stack.at(-1);
      const top = next.at(-1);
      if (!stack.length && next.length) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
      for (const dialog of next) if (!returnFocus.has(dialog)) returnFocus.set(dialog, lastFocus);
      if (top) {
        let branch: HTMLElement = top;
        while (branch.parentElement) {
          for (const sibling of branch.parentElement.children) if (sibling !== branch && sibling instanceof HTMLElement && !['SCRIPT', 'STYLE'].includes(sibling.tagName)) {
            inerted.set(sibling, sibling.inert); sibling.inert = true;
          }
          branch = branch.parentElement;
          if (branch === document.body) break;
        }
      }
      stack = next;
      if (oldTop && !next.includes(oldTop)) {
        const target = returnFocus.get(oldTop);
        returnFocus.delete(oldTop);
        if (target?.isConnected && !target.closest('[inert]')) target.focus();
        else if (top) focusFirst(top);
      } else if (top && top !== oldTop) focusFirst(top);
      if (!next.length) document.body.style.overflow = previousOverflow;
    };
    const keydown = (event: KeyboardEvent) => {
      const top = stack.at(-1);
      if (!top) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        const close = top.querySelector<HTMLButtonElement>('button[aria-label^="Close"], button[aria-label^="Cancel"]');
        if (close) close.click();
        else top.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }
      if (event.key === 'Tab') {
        const controls = visibleControls(top);
        const current = controls.indexOf(document.activeElement as HTMLElement);
        if (!controls.length) { event.preventDefault(); top.focus(); }
        else if (event.shiftKey && current <= 0) { event.preventDefault(); controls.at(-1)!.focus(); }
        else if (!event.shiftKey && (current < 0 || current === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
      }
    };
    const focusin = (event: FocusEvent) => { const top = stack.at(-1); const target = event.target as HTMLElement; if (top && !top.contains(target) && !target.closest('[aria-modal="true"]')) focusFirst(top); else if (!target.closest('[aria-modal="true"]') || top?.contains(target)) lastFocus = target; };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] });
    window.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin);
    update();
    return () => { observer.disconnect(); window.removeEventListener('keydown', keydown, true); document.removeEventListener('focusin', focusin); restoreInert(); if (stack.length) document.body.style.overflow = previousOverflow; };
  }, []);
  return null;
}
