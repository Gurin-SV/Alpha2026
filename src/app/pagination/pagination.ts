import { Component, EventEmitter, Input, Output } from "@angular/core";

@Component({
  imports: [],
  selector: "app-pagination",
  styleUrl: "./pagination.css",
  templateUrl: "./pagination.html",
})
export class PaginationComponent {
  @Input() currentPage = 0;
  @Input() totalPages = 1;

  @Output() first = new EventEmitter<void>();
  @Output() prev = new EventEmitter<void>();
  @Output() next = new EventEmitter<void>();
  @Output() last = new EventEmitter<void>();

  get canPrev(): boolean {
    return this.currentPage > 0;
  }

  get canNext(): boolean {
    return this.currentPage < this.totalPages - 1;
  }
}