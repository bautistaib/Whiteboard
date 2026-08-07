/** Flag para que el click del borrador no borre el objeto entero tras un arrastre. */
let eraseDraggedAt = 0;

export function markEraseDragged() {
  eraseDraggedAt = performance.now();
}

/** true si hubo un arrastre de borrador en los últimos ~200 ms (el click es posterior al mouseup). */
export function eraseJustDragged(): boolean {
  return performance.now() - eraseDraggedAt < 200;
}
