/**
 * Add a long-press (touch-and-hold) handler to an element.
 * Used as a mobile alternative to right-click/contextmenu.
 *
 * @param el Target element
 * @param callback Called with the Touch when long-press completes
 * @param duration Hold time in ms (default 500)
 * @returns Cleanup function to remove all listeners
 */
export function addLongPress(
	el: HTMLElement,
	callback: (touch: Touch) => void,
	duration = 500,
): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let startTouch: Touch | null = null;

	const onStart = (e: TouchEvent) => {
		if (e.touches.length !== 1) return;
		startTouch = e.touches[0]!;
		timer = setTimeout(() => {
			if (startTouch) {
				e.preventDefault();
				callback(startTouch);
			}
			timer = null;
		}, duration);
	};

	const onMove = (e: TouchEvent) => {
		if (!startTouch || !timer) return;
		const t = e.touches[0]!;
		const dx = t.clientX - startTouch.clientX;
		const dy = t.clientY - startTouch.clientY;
		// Cancel if finger moves more than 10px
		if (dx * dx + dy * dy > 100) {
			clearTimeout(timer);
			timer = null;
		}
	};

	const onEnd = () => {
		if (timer) clearTimeout(timer);
		timer = null;
		startTouch = null;
	};

	el.addEventListener("touchstart", onStart, { passive: false });
	el.addEventListener("touchmove", onMove, { passive: true });
	el.addEventListener("touchend", onEnd);
	el.addEventListener("touchcancel", onEnd);

	return () => {
		el.removeEventListener("touchstart", onStart);
		el.removeEventListener("touchmove", onMove);
		el.removeEventListener("touchend", onEnd);
		el.removeEventListener("touchcancel", onEnd);
	};
}
