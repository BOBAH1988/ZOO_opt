import { useCallback, useEffect, type RefObject } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const PAGES: readonly string[] = ['/reports', '/route', '/run', '/kpi', '/clients', '/lists'];

const SWIPE_THRESHOLD = 70;
const QUICK_SWIPES = 35;
const MAX_SWIPE_TIME = 400;

type Direction = 'left' | 'right';

export function usePageSwipe(ref: RefObject<HTMLDivElement>) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const switchPage = useCallback((dir: Direction) => {
    const idx = PAGES.indexOf(pathname);
    if (idx === -1) return;
    const next = dir === 'left' ? (idx + 1) % PAGES.length : (idx - 1 + PAGES.length) % PAGES.length;
    navigate(PAGES[next]);
  }, [navigate, pathname]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let startTime = 0;
    let locked = false;
    let dir: Direction | null = null;

    const blocked = () => Boolean(document.querySelector('.menu-dropdown'));

    const onStart = (e: TouchEvent) => {
      if (blocked()) return;
      let target = e.target as HTMLElement | null;
      while (target) {
        if (
          target.matches('button, a, input, select, textarea, [role="button"]') ||
          target.closest('.route-table-wrapper')
        ) {
          return;
        }
        target = target.parentElement;
      }
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      lastX = startX;
      startTime = Date.now();
      locked = false;
      dir = null;
    };

    const onMove = (e: TouchEvent) => {
      if (blocked()) return;
      let target = e.target as HTMLElement | null;
      while (target) {
        if (
          target.matches('button, a, input, select, textarea, [role="button"]') ||
          target.closest('.route-table-wrapper')
        ) {
          return;
        }
        target = target.parentElement;
      }

      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (!locked) {
        if (Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(dy)) {
          locked = true;
          dir = dx > 0 ? 'right' : 'left';
          lastX = touch.clientX;
          el.classList.add('swipe-dragging');
          e.preventDefault();
        }
        return;
      }

      lastX = touch.clientX;
      e.preventDefault();
    };

    const onEnd = () => {
      el.classList.remove('swipe-dragging');
      if (!locked || !dir) return;

      const dx = lastX - startX;
      const elapsed = Date.now() - startTime;
      const enough =
        Math.abs(dx) > SWIPE_THRESHOLD || (Math.abs(dx) > QUICK_SWIPES && elapsed < MAX_SWIPE_TIME);

      if (enough) {
        switchPage(dir);
      }
    };

    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);

    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [switchPage]);
}
