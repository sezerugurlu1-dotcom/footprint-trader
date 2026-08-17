// P3 #28: top-level error boundary. Catches render-phase exceptions and
// shows a fallback instead of taking the whole app down on a Binance WS
// parse error or chart init failure.

import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
     
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center bg-tv-bg text-tv-text p-6 text-center">
          <div className="text-lg font-semibold mb-2">Something went wrong</div>
          <pre className="text-xs text-tv-textDim max-w-2xl overflow-auto whitespace-pre-wrap">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-4 px-3 py-1.5 bg-tv-accent rounded text-white text-sm"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
