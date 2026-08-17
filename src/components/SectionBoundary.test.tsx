// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SectionBoundary } from './SectionBoundary';

// A child that always throws so we can exercise the error path.
// `never` return type is required so TypeScript accepts this as a
// valid JSX element even though the function never returns.
function Boom({ message = 'boom' }: { message?: string }): never {
  throw new Error(message);
}

// Suppress the React error boundary console.error noise during the
// throw test (the boundary logs via componentDidCatch, and React also
// logs the unhandled rejection).
const origError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});
afterEach(() => {
  console.error = origError;
  cleanup();
});

describe('SectionBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <SectionBoundary label="Chart">
        <div data-testid="ok">hello</div>
      </SectionBoundary>,
    );
    expect(screen.getByTestId('ok')).toBeTruthy();
    // No fallback rendered \u2014 we use queryAllByText because React 18 strict
    // mode can leave residual nodes from the test framework.
    expect(screen.queryByText(/Chart failed/)).toBeNull();
  });

  it('renders the fallback with the section label when a child throws', () => {
    render(
      <SectionBoundary label="Chart">
        <Boom message="lightweight-charts exploded" />
      </SectionBoundary>,
    );
    // Look for our specific fallback by text content (avoids React 18's
    // additional error-overlay nodes that also carry role="alert").
    expect(screen.getByText('Chart failed')).toBeTruthy();
    expect(screen.getByText('lightweight-charts exploded')).toBeTruthy();
  });

  it('falls back gracefully when the thrown value is not an Error', () => {
    function ThrowString(): never {
       
      throw 'string error';
    }
    render(
      <SectionBoundary label="Order book">
        <ThrowString />
      </SectionBoundary>,
    );
    expect(screen.getByText('Order book failed')).toBeTruthy();
    expect(screen.getByText('string error')).toBeTruthy();
  });

  it('uses a custom fallback when provided', () => {
    render(
      <SectionBoundary
        label="Chart"
        fallback={(err) => <div data-testid="custom">custom: {err.message}</div>}
      >
        <Boom message="err-42" />
      </SectionBoundary>,
    );
    const custom = screen.getByTestId('custom');
    expect(custom.textContent).toBe('custom: err-42');
    // Default fallback should NOT be rendered when a custom one is supplied
    expect(screen.queryByText(/Chart failed/)).toBeNull();
  });

  it('isolates failures \u2014 a thrown child does not break a sibling', () => {
    render(
      <>
        <SectionBoundary label="A">
          <div data-testid="a-ok">A is fine</div>
        </SectionBoundary>
        <SectionBoundary label="B">
          <Boom message="B is broken" />
        </SectionBoundary>
      </>,
    );
    expect(screen.getByTestId('a-ok')).toBeTruthy();
    expect(screen.getByText('B failed')).toBeTruthy();
  });
});
