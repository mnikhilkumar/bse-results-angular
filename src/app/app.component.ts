import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

interface ResultEvent {
  scripCode: string;
  symbol: string;
  company: string;
  meetingDate: string;
  url: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html'
})
export class AppComponent {
  private http = inject(HttpClient);
  fromDate = this.offsetDate(0);
  toDate = this.offsetDate(91);
  symbol = '';
  events: ResultEvent[] = [];
  loading = false;
  error = '';
  lastUpdated = '';
  today = this.offsetDate(0);

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.error = '';
    if (this.fromDate < this.today) this.fromDate = this.today;
    if (this.toDate < this.fromDate) this.toDate = this.fromDate;
    const params = new URLSearchParams({ from_date: this.fromDate, to_date: this.toDate });
    this.http.get<{data: ResultEvent[]; updatedAt: string; today: string}>(`/api/event-calendar?${params}`)
      .subscribe({
        next: r => {
          const filter = this.symbol.trim().toUpperCase();
          this.events = (r.data || []).filter(x => !filter || x.symbol.toUpperCase().includes(filter) || x.company.toUpperCase().includes(filter));
          this.lastUpdated = r.updatedAt;
          this.today = r.today || this.today;
          this.loading = false;
        },
        error: e => {
          this.error = e?.error?.message || 'Unable to load BSE financial result dates.';
          this.loading = false;
        }
      });
  }

  offsetDate(days: number) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
