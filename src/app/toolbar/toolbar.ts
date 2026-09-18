import { Component, inject } from "@angular/core";
import { AppStateService, SearchMode, Theme } from "../app-state.service";

@Component({
  selector: "app-toolbar",
  imports: [],
  templateUrl: "./toolbar.html",
  styleUrl: "./toolbar.css",
})
export class ToolbarComponent {
  readonly state = inject(AppStateService);

  readonly themes: { value: Theme; label: string }[] = [
    { value: "light", label: "Светлая тема" },
    { value: "dark", label: "Тёмная тема" },
  ];

  readonly scales = [100, 110, 125, 150, 175, 200, 225, 300];

  setTheme(theme: Theme): void {
    this.state.setTheme(theme);
  }

  setScale(value: string): void {
    this.state.setScale(Number(value));
  }

  goBack(): void {
    this.state.goBack();
  }

  goForward(): void {
    this.state.goForward();
  }

  openHelp(): void {
    this.state.loadHelp("index.html");
    this.state.commitToHistory();
  }

  clearInput(): void {
    this.state.clearInput();
  }
}