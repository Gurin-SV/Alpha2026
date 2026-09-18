import { Component, ElementRef, ViewChild, inject, effect, signal } from "@angular/core";
import { AppStateService, InputLanguage } from "../app-state.service";
import { DIACRITICS } from "./diacritics";
import { LAYOUT_GR, LAYOUT_LA, LAYOUT_RU } from "../keyboard-layouts";
import { VirtualKeyboard } from "./virtual-keyboard/virtual-keyboard";

@Component({
  selector: "app-input-area",
  imports: [VirtualKeyboard],
  templateUrl: "./input-area.html",
  styleUrl: "./input-area.css",
})
export class InputAreaComponent {
  readonly state = inject(AppStateService);
  readonly diacriticVariants = signal<string[]>([]);

  @ViewChild("textarea", { static: true })
  textarea!: ElementRef<HTMLTextAreaElement>;

  readonly languages: { value: InputLanguage; label: string; title: string }[] = [
    { value: "gr", label: "Gr", title: "Греческая раскладка" },
    { value: "la", label: "La", title: "Латинская раскладка" },
    { value: "ru", label: "Ru", title: "Русская раскладка" },
  ];

  readonly showKeyboard = signal<boolean>(false);

  constructor() {
    effect(() => {
      const _ = this.state.clearInputSignal();
      if (this.textarea) {
        this.textarea.nativeElement.value = "";
      }
    });

    document.addEventListener("click", (e) => {
      if (!this.showKeyboard()) return;
      const target = e.target as HTMLElement;
      if (target.closest(".keyboard-popup")
        || target.closest(".languages")
        || target.closest(".diacritics-panel")) return;
      this.hideKeyboard();
    });
  }

  setLanguage(lang: InputLanguage): void {
    this.state.inputLanguage.set(lang);
    this.textarea.nativeElement.focus();
  }

  toggleKeyboard(): void {
    this.showKeyboard.update(v => !v);
    this.textarea.nativeElement.focus();
  }

  hideKeyboard(): void {
    this.showKeyboard.set(false);
  }

  async onKeyDown(event: KeyboardEvent): Promise<void> {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const word = this.currentWord();
      if (word) {
        await this.state.enterOnWord(word);
        this.state.commitToHistory();
      }
      return;
    }

    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      const word = this.currentWord();
      if (word) {
        await this.state.enterOnWord(word, true);
        this.state.commitToHistory();
      }
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key.length !== 1) return;

    const lang = this.state.inputLanguage();
    const layout = lang === "gr" ? LAYOUT_GR : lang === "ru" ? LAYOUT_RU : LAYOUT_LA;
    const entry = layout[event.code];
    if (!entry) return;

    event.preventDefault();
    const ch = event.shiftKey ? entry[1] : entry[0];
    this.insertAtCursor(ch);
  }

  private insertAtCursor(ch: string): void {
    const el = this.textarea.nativeElement;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = el.value;
    el.value = text.slice(0, start) + ch + text.slice(end);
    const pos = start + ch.length;
    el.setSelectionRange(pos, pos);
    this.onInput();
  }

  onInput(): void {
    const word = this.currentWord();
    if (word) {
      this.state.loadPrefixPage(word, 0, 20);
    }
    this.updateDiacritics();
  }

  async onDoubleClick(event: MouseEvent): Promise<void> {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    let word = selection.toString().trim();
    if (!word) return;

    word = word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    if (!word) return;

    await this.state.enterOnWord(word, event.shiftKey);
    this.state.commitToHistory();
  }

  private currentWord(): string {
    const el = this.textarea.nativeElement;
    const text = el.value;
    const pos = el.selectionStart;

    if (!text) return "";

    let start = pos;
    let end = pos;
    while (start > 0 && !this.isBoundary(text[start - 1])) start--;
    while (end < text.length && !this.isBoundary(text[end])) end++;

    return text.substring(start, end).trim();
  }

  private isBoundary(c: string): boolean {
    return /[\s.,;:!?()[\]{}«»"'`]/.test(c);
  }

  private canonicalizeChar(ch: string): string {
    return ch.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  }

  private isUpperChar(ch: string): boolean {
    return ch !== ch.toLowerCase() && ch === ch.toUpperCase();
  }

  updateDiacritics(): void {
    const el = this.textarea.nativeElement;
    const pos = el.selectionStart ?? 0;
    if (pos === 0) {
      this.diacriticVariants.set([]);
      return;
    }
    const ch = el.value[pos - 1];
    if (!ch) {
      this.diacriticVariants.set([]);
      return;
    }
    const base = this.canonicalizeChar(ch);
    const entry = DIACRITICS[base];
    if (!entry) {
      this.diacriticVariants.set([]);
      return;
    }
    const isUpper = this.isUpperChar(ch);
    const list = isUpper ? entry.upper : entry.lower;
    this.diacriticVariants.set(list);
  }

  applyDiacritic(v: string): void {
    const el = this.textarea.nativeElement;
    const pos = el.selectionStart ?? 0;
    if (pos === 0) return;
    const before = el.value.slice(0, pos - 1);
    const after = el.value.slice(pos);
    el.value = before + v + after;
    el.setSelectionRange(pos, pos);
    el.focus();
    this.onInput();
    this.updateDiacritics();
  }

  // ---- Виртуальная клавиатура ----

  onVirtualKey(ch: string): void {
    this.insertAtCursor(ch);
    this.textarea.nativeElement.focus();
  }

  onVirtualBackspace(): void {
    const el = this.textarea.nativeElement;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = el.value;
    if (start === end && start > 0) {
      el.value = text.slice(0, start - 1) + text.slice(start);
      el.setSelectionRange(start - 1, start - 1);
    } else {
      el.value = text.slice(0, start) + text.slice(end);
      el.setSelectionRange(start, start);
    }
    this.textarea.nativeElement.focus();
    this.onInput();
  }

  onVirtualSpace(): void {
    this.insertAtCursor(" ");
    this.textarea.nativeElement.focus();
  }

  async onVirtualEnter(): Promise<void> {
    this.hideKeyboard();
    const word = this.currentWord();
    if (word) {
      await this.state.enterOnWord(word);
      this.state.commitToHistory();
    }
  }
}