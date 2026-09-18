import { Component, inject } from "@angular/core";
import { DomSanitizer, SafeHtml } from "@angular/platform-browser";
import { AppStateService } from "../app-state.service";
import { PaginationComponent } from "../pagination/pagination";

const PAGE_SIZE = 20;

@Component({
  selector: "app-content-area",
  imports: [PaginationComponent],
  templateUrl: "./content-area.html",
  styleUrl: "./content-area.css",
})
export class ContentArea {
  readonly state = inject(AppStateService);
  readonly pageSize = PAGE_SIZE;
  private sanitizer = inject(DomSanitizer);

  trustHtml(html: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  highlight(s: string): string {
    return s.replace(/\[\[/g, "<mark>").replace(/\]\]/g, "</mark>");
  }

  openKey(key: string): void {
    this.state.loadArticle(key);
    this.state.commitToHistory();
  }

  async onArticleDoubleClick(event: MouseEvent): Promise<void> {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    let word = selection.toString().trim();
    if (!word) return;

    word = word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    if (!word) return;

    await this.state.enterOnWord(word, event.shiftKey);
    this.state.commitToHistory();
  }

  // ---- Пагинация ----

  get totalPrefixPages(): number {
    return Math.max(1, Math.ceil(this.state.totalKeys() / PAGE_SIZE));
  }

  async goFirst(): Promise<void> {
    await this.state.gotoFirstPrefixPage(PAGE_SIZE);
  }

  async goPrev(): Promise<void> {
    await this.state.gotoPrevPrefixPage(PAGE_SIZE);
  }

  async goNext(): Promise<void> {
    await this.state.gotoNextPrefixPage(PAGE_SIZE);
  }

  async goLast(): Promise<void> {
    await this.state.gotoLastPrefixPage(PAGE_SIZE);
  }

  onHelpClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const link = target.closest("a") as HTMLAnchorElement | null;
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href) return;

    event.preventDefault();

    if (href.endsWith(".html")) {
      this.state.loadHelp(href);
    }
    // внешние ссылки игнорируем
  }
}