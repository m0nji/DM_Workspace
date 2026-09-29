// Dialoge, die Enter auf window abfangen, dürfen den fokussierten Button nicht
// überstimmen: ein Tab auf "Abbrechen" und Enter muss "Abbrechen" auslösen, nicht
// die Primäraktion. Elemente, die Enter selbst verarbeiten, bleiben deshalb bei
// sich; ein Textfeld dagegen ist genau der Ort, an dem Enter den Dialog bestätigt.
// Während einer IME-Komposition (Japanisch, Chinesisch, Koreanisch) bestätigt
// Enter die Komposition, nicht den Dialog.
const HANDLES_ENTER_ITSELF = 'button, a[href], select, textarea, summary, [role="button"], [contenteditable=""], [contenteditable="true"]';

export function isDialogEnter(e: Pick<KeyboardEvent, 'key' | 'isComposing' | 'target'>): boolean {
  if (e.key !== 'Enter' || e.isComposing) return false;
  const target = e.target;
  return !(target instanceof Element && target.closest(HANDLES_ENTER_ITSELF));
}
