import { Component, EventEmitter, Input, Output, inject } from "@angular/core";
import { AppStateService, InputLanguage } from "../../app-state.service";
import { LAYOUT_GR, LAYOUT_LA, LAYOUT_RU } from "../../keyboard-layouts";

interface KeyDef {
  code: string;      // event.code
  ch: string;        // символ на выбранном языке
  en: string;        // английский символ (из LAYOUT_LA)
  width: number;     // множитель ширины (1 = обычная, для пробела больше)
  isAction?: "space" | "backspace" | "enter";
}

@Component({
  selector: "app-virtual-keyboard",
  imports: [],
  templateUrl: "./virtual-keyboard.html",
  styleUrl: "./virtual-keyboard.css",
})
export class VirtualKeyboard {
  readonly state = inject(AppStateService);

  @Output() key = new EventEmitter<string>();
  @Output() backspace = new EventEmitter<void>();
  @Output() space = new EventEmitter<void>();
  @Output() enter = new EventEmitter<void>();

  // Три ряда кодов клавиш как на QWERTY
  private readonly rows: string[][] = [
    ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft", "BracketRight"],
    ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote"],
    ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash"],
  ];

  getKeys(): KeyDef[] {
    const lang = this.state.inputLanguage();
    const langMap = lang === "gr" ? LAYOUT_GR : lang === "ru" ? LAYOUT_RU : LAYOUT_LA;
    const result: KeyDef[] = [];

    for (const row of this.rows) {
      for (const code of row) {
        const langEntry = langMap[code];
        const laEntry = LAYOUT_LA[code];
        if (!langEntry) continue;
        result.push({
          code,
          ch: langEntry[0],
          en: laEntry ? laEntry[0] : "",
          width: 1,
        });
      }
    }
    return result;
  }

  getKeyRows(): KeyDef[][] {
    const keys = this.getKeys();
    const rows: KeyDef[][] = [[], [], []];
    let i = 0;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < this.rows[r].length; c++) {
        if (i < keys.length) rows[r].push(keys[i]);
        i++;
      }
    }
    return rows;
  }

  onKeyClick(k: KeyDef): void {
    this.key.emit(k.ch);
  }

  onSpace(): void { this.space.emit(); }
  onBackspace(): void { this.backspace.emit(); }
  onEnter(): void { this.enter.emit(); }
}