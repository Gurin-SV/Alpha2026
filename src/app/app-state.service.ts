import { Injectable, signal, computed } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";

export type ContentType = "help" | "article" | "list" | "fts" | "error";
export type SearchMode = "incremental" | "exact" | "approximate" | "fulltext";
export type InputLanguage = "gr" | "la" | "ru";
export type Theme = "light" | "dark";

export interface ArticleRow {
    caption: string;
    html: string;
}

export interface KeyRow {
    key: string;
    captions: string[];
}

export interface FtsRow {
    key: string;
    caption: string;
    snippet: string;
}

interface HistoryEntry {
    contentType: ContentType;
    currentKey?: string;
    currentPrefix?: string;
    currentPrefixPage?: number;
    currentFtsQuery?: string;
    currentFtsPage?: number;
    currentHelpFile?: string;
}

@Injectable({ providedIn: "root" })
export class AppStateService {
    // ---- Тип содержимого и параметры ----
    readonly contentType = signal<ContentType>("help");
    readonly currentKey = signal<string>("");
    readonly currentPrefix = signal<string>("");
    readonly currentPrefixPage = signal<number>(0);
    readonly currentFtsQuery = signal<string>("");
    readonly currentFtsPage = signal<number>(0);
    readonly currentHelpFile = signal<string>("");

    // ---- Настройки ----
    readonly inputLanguage = signal<InputLanguage>("gr");
    readonly theme = signal<Theme>("light");
    readonly scale = signal<number>(100);
    readonly clearInputSignal = signal<number>(0);

    // ---- Данные ----
    readonly articles = signal<ArticleRow[]>([]);
    readonly keys = signal<KeyRow[]>([]);
    readonly ftsRows = signal<FtsRow[]>([]);
    readonly helpHtml = signal<string>("");
    readonly errorMessage = signal<string>("");
    readonly totalKeys = signal<number>(0);

    // ---- История ----
    private readonly history = signal<HistoryEntry[]>([]);
    private readonly historyIndex = signal<number>(-1);

    readonly canGoBack = signal<boolean>(false);
    readonly canGoForward = signal<boolean>(false);
    readonly ftsPage = signal<number>(0);

    async loadArticle(key: string): Promise<void> {
        this.contentType.set("article");
        this.currentKey.set(key);
        this.articles.set([]);
        this.keys.set([]);
        this.ftsRows.set([]);
        this.errorMessage.set("");
        try {
            const rows = await invoke<ArticleRow[]>("get_article", { key });
            this.articles.set(rows);
        } catch (e) {
            this.contentType.set("error");
            this.errorMessage.set(String(e));
        }
    }

    async loadPrefixPage(prefix: string, page: number, pageSize: number): Promise<void> {
        this.contentType.set("list");
        this.currentPrefix.set(prefix);
        this.currentPrefixPage.set(page);
        this.articles.set([]);
        this.keys.set([]);
        this.ftsRows.set([]);
        this.errorMessage.set("");
        try {
            const offset = page * pageSize;
            const rows = await invoke<KeyRow[]>("search_prefix", {
                prefix,
                limit: pageSize,
                offset,
            });
            this.keys.set(rows);
            const total = await invoke<number>("count_prefix", { prefix });
            this.totalKeys.set(total);
        } catch (e) {
            this.contentType.set("error");
            this.errorMessage.set(String(e));
        }
    }

    async loadFtsPage(query: string, page: number, pageSize: number): Promise<void> {
        this.ftsPage.set(0);
        this.contentType.set("fts");
        this.currentFtsQuery.set(query);
        this.currentFtsPage.set(page);
        this.articles.set([]);
        this.keys.set([]);
        this.ftsRows.set([]);
        this.errorMessage.set("");
        try {
            const offset = page * pageSize;
            const rows = await invoke<FtsRow[]>("search_fulltext", {
                query,
                limit: pageSize,
                offset,
            });
            this.ftsRows.set(rows);
        } catch (e) {
            this.contentType.set("error");
            this.errorMessage.set(String(e));
        }
    }

    async loadHelp(fileName: string): Promise<void> {
        this.contentType.set("help");
        this.currentHelpFile.set(fileName);
        this.articles.set([]);
        this.keys.set([]);
        this.ftsRows.set([]);
        this.errorMessage.set("");
        try {
            const resp = await fetch(`assets/help/${fileName}`);
            if (!resp.ok) return;
            const html = await resp.text();
            this.helpHtml.set(html);
        } catch (e) {
            this.contentType.set("error");
            this.errorMessage.set(String(e));
        }
    }

    async enterOnWord(word: string, forceFulltext = false): Promise<void> {
        if (!word) return;

        const isRussian = this.detectLanguage(word) === "ru";

        if (forceFulltext || isRussian) {
            await this.fulltextSearch(word);
            return;
        }

        await this.exactThenCanonical(word);
    }

    async exactThenCanonical(word: string): Promise<void> {
        try {
            const rows = await invoke<ArticleRow[]>("get_article", { key: word });
            if (rows.length > 0) {
                await this.loadArticle(word);
                this.commitToHistory();
                return;
            }
        } catch {
            // игнорируем — переходим к каноническому
        }
        await this.canonicalSearch(word);
        this.commitToHistory();
    }
    
    async canonicalSearch(word: string): Promise<void> {
        this.contentType.set("list");
        this.currentPrefix.set(word);
        this.currentPrefixPage.set(0);
        this.articles.set([]);
        this.keys.set([]);
        this.ftsRows.set([]);
        this.errorMessage.set("");
        try {
            const rows = await invoke<KeyRow[]>("search_canonical_keys", { word });
            this.keys.set(rows);
            this.totalKeys.set(rows.length);
        } catch (e) {
            this.contentType.set("error");
            this.errorMessage.set(String(e));
        }
    }
    
    async fulltextSearch(query: string): Promise<void> {
        const pageSize = 1000;
        await this.loadFtsPage(query, 0, pageSize);
    }

    detectLanguage(word: string): "gr" | "la" | "ru" | "" {
        if (!word) return "";
        const code = word.codePointAt(0)!;
        if ((code >= 0x0370 && code <= 0x03FF) || (code >= 0x1F00 && code <= 0x1FFF))
            return "gr";
        if ((code >= 0x0041 && code <= 0x007A) || (code >= 0x00C0 && code <= 0x024F))
            return "la";
        if (code >= 0x0400 && code <= 0x04FF) return "ru";
        return "";
    }

    public commitToHistory(): void {
        const entry: HistoryEntry = {
            contentType: this.contentType(),
            currentKey: this.currentKey(),
            currentPrefix: this.currentPrefix(),
            currentPrefixPage: this.currentPrefixPage(),
            currentFtsQuery: this.currentFtsQuery(),
            currentFtsPage: this.currentFtsPage(),
            currentHelpFile: this.currentHelpFile(),
        };

        const current = this.history();
        const idx = this.historyIndex();
        const truncated = current.slice(0, idx + 1);

        truncated.push(entry);

        while (truncated.length > 20) {
            truncated.shift();
        }

        this.history.set(truncated);
        this.historyIndex.set(truncated.length - 1);
        this.updateNavFlags();
    }

    private updateNavFlags(): void {
        const idx = this.historyIndex();
        const len = this.history().length;
        this.canGoBack.set(idx > 0);
        this.canGoForward.set(idx < len - 1);
    }

    async goBack(): Promise<void> {
        if (!this.canGoBack()) return;
        const newIndex = this.historyIndex() - 1;
        this.historyIndex.set(newIndex);
        await this.applyHistoryEntry(this.history()[newIndex]);
        this.updateNavFlags();
    }

    async goForward(): Promise<void> {
        if (!this.canGoForward()) return;
        const newIndex = this.historyIndex() + 1;
        this.historyIndex.set(newIndex);
        await this.applyHistoryEntry(this.history()[newIndex]);
        this.updateNavFlags();
    }

    private async applyHistoryEntry(entry: HistoryEntry): Promise<void> {
        switch (entry.contentType) {
            case "article":
                await this.loadArticle(entry.currentKey ?? "");
                break;
            case "list":
                await this.loadPrefixPage(
                    entry.currentPrefix ?? "",
                    entry.currentPrefixPage ?? 0,
                    20
                );
                break;
            case "fts":
                await this.loadFtsPage(
                    entry.currentFtsQuery ?? "",
                    entry.currentFtsPage ?? 0,
                    1000
                );
                break;
            case "help":
                await this.loadHelp(entry.currentHelpFile ?? "scenarios.html");
                break;
        }
    }

    async loadSettings(): Promise<void> {
        try {
            const s = await invoke<{ theme: Theme; scale: number }>("get_settings");
            this.theme.set(s.theme);
            this.scale.set(s.scale);
        } catch {
            // оставляем значения по умолчанию
        }
        this.applyTheme();
        this.applyScale();
    }

    async saveSettings(): Promise<void> {
        try {
            await invoke("save_settings", {
                theme: this.theme(),
                scale: this.scale(),
            });
        } catch {
            // игнорируем
        }
    }

    setTheme(theme: Theme): void {
        this.theme.set(theme);
        this.applyTheme();
        this.saveSettings();
    }

    setScale(scale: number): void {
        this.scale.set(scale);
        this.applyScale();
        this.saveSettings();
    }

    clearInput(): void {
        this.clearInputSignal.update(n => n + 1);
    }

    private applyTheme(): void {
        const html = document.documentElement;
        html.classList.remove("theme-light", "theme-dark");
        html.classList.add(`theme-${this.theme()}`);
    }

    private applyScale(): void {
        const html = document.documentElement;
        const basePx = 16 * (this.scale() / 100);
        html.style.fontSize = `${basePx}px`;
    }

    async initialize(): Promise<void> {
        await this.loadSettings();
        await this.loadHelp("scenarios.html");
        this.commitToHistory();
    }

    async gotoPrefixPage(page: number, pageSize: number): Promise<void> {
        const prefix = this.currentPrefix();
        if (!prefix) return;
        const total = this.totalKeys();
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const clamped = Math.max(0, Math.min(page, totalPages - 1));
        await this.loadPrefixPage(prefix, clamped, pageSize);
    }

    async gotoFirstPrefixPage(pageSize: number): Promise<void> {
        await this.gotoPrefixPage(0, pageSize);
    }

    async gotoLastPrefixPage(pageSize: number): Promise<void> {
        const totalPages = Math.max(1, Math.ceil(this.totalKeys() / pageSize));
        await this.gotoPrefixPage(totalPages - 1, pageSize);
    }

    async gotoPrevPrefixPage(pageSize: number): Promise<void> {
        await this.gotoPrefixPage(this.currentPrefixPage() - 1, pageSize);
    }

    async gotoNextPrefixPage(pageSize: number): Promise<void> {
        await this.gotoPrefixPage(this.currentPrefixPage() + 1, pageSize);
    }

    readonly ftsTotalPages = computed(() =>
        Math.max(1, Math.ceil(this.ftsRows().length / 20))
    );

    readonly ftsPageRows = computed(() => {
        const page = this.ftsPage();
        return this.ftsRows().slice(page * 20, (page + 1) * 20);
    });

    goFtsFirst(): void { this.ftsPage.set(0); }
    goFtsPrev(): void { this.ftsPage.update(p => Math.max(0, p - 1)); }
    goFtsNext(): void { this.ftsPage.update(p => Math.min(this.ftsTotalPages() - 1, p + 1)); }
    goFtsLast(): void { this.ftsPage.set(this.ftsTotalPages() - 1); }
}