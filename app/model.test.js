import { describe, expect, test } from 'bun:test';
import { nextOccurrence } from './model.js';

const task = (due, repeat) => ({
  id: 'series', title: 'Recurring task', notes: '', due, priority: 0, parent: null,
  done: true, deleted: false, revision: 4, list_id: null, tags: [], pinned: false,
  repeat, series_source: null, reminders: [],
});

describe('recurring occurrences', () => {
  test('keeps a monthly calendar anchor after a short month', () => {
    const repeat = { unit: 'month', interval: 1, end: '', anchor: '2028-01-31' };
    const february = nextOccurrence(task('2028-01-31T09:30', repeat));
    const march = nextOccurrence(february);
    expect(february.due).toBe('2028-02-29T09:30');
    expect(march.due).toBe('2028-03-31T09:30');
  });

  test('uses a deterministic id and respects the repeat end date', () => {
    const repeat = { unit: 'day', interval: 3, end: '2026-09-25', anchor: '2026-09-22' };
    const next = nextOccurrence(task('2026-09-22', repeat));
    expect(next.id).toBe('series@2026-09-25');
    expect(nextOccurrence(next)).toBeNull();
  });

  test('moves through selected weekdays', () => {
    const repeat = { unit: 'week', interval: 1, end: '', anchor: '2026-09-21', weekdays: [1, 3, 5] };
    expect(nextOccurrence(task('2026-09-21', repeat)).due).toBe('2026-09-23');
    expect(nextOccurrence(task('2026-09-23', repeat)).due).toBe('2026-09-25');
  });
});
