// Splitter/panel drags track the mouse via window-level mousemove/mouseup
// listeners. The preview <webview> is an out-of-process guest: once the pointer
// crosses it, the host page stops receiving mouse events, the mouseup lands in
// the guest, and the drag "sticks" to the mouse. While a drag is active this
// marks <body> so the stylesheet can turn pointer-events off on every webview
// (see styles.css: body.drag-active webview).
export function beginDragGuard(): () => void {
  document.body.classList.add('drag-active');
  return () => document.body.classList.remove('drag-active');
}
