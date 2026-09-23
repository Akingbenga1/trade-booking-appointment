'use client';

import { useMemo, useState } from 'react';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sameDay(a, b) {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function timeFromDate(d) {
  if (!d) return '09:00';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function combineLocal(day, hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  const out = new Date(day);
  out.setHours(h || 0, m || 0, 0, 0);
  return out;
}

function toDatetimeLocalValue(d) {
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Build default window: tomorrow 09:00 – tomorrow 17:00 */
export function defaultScheduleRange() {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(17, 0, 0, 0);
  return { scheduleStart: start, scheduleEnd: end };
}

/** Inclusive calendar-day count for a schedule window. */
export function scheduleDayCount(start, end) {
  if (!start || !end) return null;
  const a = start instanceof Date ? start : new Date(start);
  const b = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b.getTime() < a.getTime()) {
    return null;
  }
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86400000) + 1;
}

export function formatScheduleRange(start, end) {
  if (!start || !end) return '';
  const a = start instanceof Date ? start : new Date(start);
  const b = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return '';
  const days = scheduleDayCount(a, b);
  const dayLabel = days == null ? '' : days === 1 ? ' (1 day)' : ` (${days} days)`;
  return `${a.toLocaleString()} – ${b.toLocaleString()}${dayLabel}`;
}

/**
 * Calendar + time (hours/minutes) range picker.
 * value: { scheduleStart: Date|null, scheduleEnd: Date|null }
 * onChange(next)
 */
export function DateTimeRangePicker({ value, onChange }) {
  const start = value?.scheduleStart ? new Date(value.scheduleStart) : null;
  const end = value?.scheduleEnd ? new Date(value.scheduleEnd) : null;
  const [cursor, setCursor] = useState(() => startOfDay(start || new Date()));
  const [picking, setPicking] = useState('start'); // start | end

  const days = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    // Monday-first
    const startPad = (first.getDay() + 6) % 7;
    const gridStart = new Date(year, month, 1 - startPad);
    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      cells.push(d);
    }
    return cells;
  }, [cursor]);

  function emit(nextStart, nextEnd) {
    onChange({
      scheduleStart: nextStart,
      scheduleEnd: nextEnd,
    });
  }

  function onPickDay(day) {
    const dayOnly = startOfDay(day);
    if (picking === 'start' || !start) {
      const nextStart = combineLocal(dayOnly, timeFromDate(start) || '09:00');
      let nextEnd = end;
      if (!nextEnd || nextEnd.getTime() <= nextStart.getTime()) {
        nextEnd = combineLocal(dayOnly, timeFromDate(end) || '17:00');
        if (nextEnd.getTime() <= nextStart.getTime()) {
          nextEnd = new Date(nextStart.getTime() + 60 * 60 * 1000);
        }
      }
      emit(nextStart, nextEnd);
      setPicking('end');
      return;
    }
    const nextEnd = combineLocal(dayOnly, timeFromDate(end) || '17:00');
    if (nextEnd.getTime() <= start.getTime()) {
      // If end day is before start, treat as new start
      const nextStart = combineLocal(dayOnly, timeFromDate(start) || '09:00');
      const adjustedEnd = new Date(nextStart.getTime() + 60 * 60 * 1000);
      emit(nextStart, adjustedEnd);
      setPicking('end');
      return;
    }
    emit(start, nextEnd);
    setPicking('start');
  }

  function onStartTime(hhmm) {
    if (!start) return;
    const nextStart = combineLocal(startOfDay(start), hhmm);
    let nextEnd = end;
    if (!nextEnd || nextEnd.getTime() <= nextStart.getTime()) {
      nextEnd = new Date(nextStart.getTime() + 60 * 60 * 1000);
    }
    emit(nextStart, nextEnd);
  }

  function onEndTime(hhmm) {
    if (!end && !start) return;
    const base = end || start;
    const nextEnd = combineLocal(startOfDay(base), hhmm);
    if (start && nextEnd.getTime() <= start.getTime()) {
      // bump end by one hour past start if invalid
      emit(start, new Date(start.getTime() + 60 * 60 * 1000));
      return;
    }
    emit(start, nextEnd);
  }

  const monthLabel = cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const summary = formatScheduleRange(start, end);

  return (
    <div className="dtrp stack">
      <div className="dtrp-toolbar row">
        <button
          className="secondary"
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
        >
          Prev
        </button>
        <strong>{monthLabel}</strong>
        <button
          className="secondary"
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
        >
          Next
        </button>
      </div>

      <div className="dtrp-hint muted">
        Selecting: <strong>{picking === 'start' ? 'start' : 'end'}</strong> — click a day on the
        calendar, then set times below.
      </div>

      <div className="dtrp-weekdays">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="dtrp-grid">
        {days.map((d) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const isStart = sameDay(d, start);
          const isEnd = sameDay(d, end);
          const inRange =
            start &&
            end &&
            startOfDay(d).getTime() >= startOfDay(start).getTime() &&
            startOfDay(d).getTime() <= startOfDay(end).getTime();
          const cls = [
            'dtrp-day',
            inMonth ? '' : 'muted',
            inRange ? 'in-range' : '',
            isStart ? 'is-start' : '',
            isEnd ? 'is-end' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={d.toISOString()}
              type="button"
              className={cls}
              onClick={() => onPickDay(d)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <div className="row dtrp-times">
        <label style={{ flex: 1 }}>
          Start time
          <input
            type="time"
            value={timeFromDate(start)}
            onChange={(e) => onStartTime(e.target.value)}
            disabled={!start}
          />
        </label>
        <label style={{ flex: 1 }}>
          End time
          <input
            type="time"
            value={timeFromDate(end)}
            onChange={(e) => onEndTime(e.target.value)}
            disabled={!end}
          />
        </label>
      </div>

      <div className="row">
        <button
          className="secondary"
          type="button"
          onClick={() => setPicking('start')}
          disabled={picking === 'start'}
        >
          Pick start day
        </button>
        <button
          className="secondary"
          type="button"
          onClick={() => setPicking('end')}
          disabled={picking === 'end' || !start}
        >
          Pick end day
        </button>
      </div>

      {summary ? <div className="dtrp-summary">{summary}</div> : null}

      {/* Hidden sync values for forms that prefer ISO strings */}
      <input type="hidden" name="scheduleStart" value={toDatetimeLocalValue(start)} readOnly />
      <input type="hidden" name="scheduleEnd" value={toDatetimeLocalValue(end)} readOnly />
    </div>
  );
}
