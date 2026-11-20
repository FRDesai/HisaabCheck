import { Component, type ErrorInfo, type ReactNode } from 'react';

/** App-level safety net: a render error shows a message and a reload button instead of a blank page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unexpected app error', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="max-w-xl mx-auto p-8">
        <div role="alert" className="bg-white rounded-lg border p-6 space-y-3">
          <p className="text-red-700">Something went wrong on this page. Your saved bills are not affected.</p>
          <button className="px-4 py-2 rounded bg-slate-800 text-white" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </main>
    );
  }
}
