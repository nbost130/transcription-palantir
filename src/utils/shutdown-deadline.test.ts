import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { armShutdownDeadline } from './shutdown-deadline.js';

describe('armShutdownDeadline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('exits with code 1 when the deadline passes', () => {
    const exit = vi.fn();
    armShutdownDeadline(5_000, exit);
    vi.advanceTimersByTime(4_999);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('does not exit when cancelled before the deadline', () => {
    const exit = vi.fn();
    const cancel = armShutdownDeadline(5_000, exit);
    vi.advanceTimersByTime(2_000);
    cancel();
    vi.advanceTimersByTime(10_000);
    expect(exit).not.toHaveBeenCalled();
  });
});
