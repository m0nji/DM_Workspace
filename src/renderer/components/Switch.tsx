import React from 'react';

/** A dark pill switch (role="switch") used both for "im Menü" per row and for
 *  the phone-access option inside the editor. A real <button> so a <label
 *  htmlFor> pointing at it keeps working with the existing click-to-toggle
 *  and Playwright getByLabel()/check() conventions a native checkbox had.
 *  `label` is optional: pass it only when nothing else names the control
 *  (e.g. no associated <label>) — otherwise both would supply the accessible
 *  name and the aria-label would just shadow the <label> redundantly. */
export function Switch({ id, checked, label, onChange }: { id?: string; checked: boolean; label?: string; onChange: (checked: boolean) => void }): React.JSX.Element {
  return <button type="button" id={id} role="switch" aria-checked={checked} aria-label={label}
    className={`switch${checked ? ' on' : ''}`} onClick={() => onChange(!checked)}>
    <span className="switch-knob" />
  </button>;
}
