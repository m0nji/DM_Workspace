// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useDocumentVisible } from '../src/renderer/use-document-visible';

let root: Root | undefined;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('document visibility', () => {
  it('changes the rendering policy without remounting panes or treating blur as hidden', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const hidden = vi.spyOn(document, 'hidden', 'get');
    hidden.mockReturnValue(false);
    const mounted = vi.fn();
    const stopped = vi.fn();
    function Pane() {
      const visible = useDocumentVisible();
      useEffect(() => { mounted(); return stopped; }, []);
      return createElement('span', null, visible ? 'foreground' : 'background');
    }
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(createElement(Pane)));
    expect(host.textContent).toBe('foreground');
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(host.textContent).toBe('foreground');
    hidden.mockReturnValue(true);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(host.textContent).toBe('background');
    hidden.mockReturnValue(false);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(host.textContent).toBe('foreground');
    expect(mounted).toHaveBeenCalledOnce();
    expect(stopped).not.toHaveBeenCalled();
    act(() => root!.unmount());
    root = undefined;
    expect(stopped).toHaveBeenCalledOnce();
  });
});
