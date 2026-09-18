import { Component, OnInit, inject } from "@angular/core";
import { AppStateService } from "./app-state.service";
import { ToolbarComponent } from "./toolbar/toolbar";
import { InputAreaComponent } from "./input-area/input-area";
import { ContentArea } from "./content-area/content-area";

@Component({
  selector: "app-root",
  imports: [ToolbarComponent, InputAreaComponent, ContentArea],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent implements OnInit {
  readonly state = inject(AppStateService);

  ngOnInit(): void {
    this.state.initialize();
  }
}