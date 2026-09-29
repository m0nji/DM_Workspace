// Zustand eines Splitter-Drags. Festgeschrieben wird nur, wenn der Zeiger sich
// wirklich bewegt hat — ein Klick (mousedown + mouseup) darf das Verhältnis
// nicht auf einen Startwert zurücksetzen.
export interface SplitDrag {
  move(ratio: number): void;
  end(): void;
}

export function createSplitDrag(resize: (ratio: number, persist: boolean) => void): SplitDrag {
  let last: number | null = null;
  return {
    move(ratio) {
      last = ratio;
      resize(ratio, false);
    },
    end() {
      if (last !== null) resize(last, true);
    }
  };
}
