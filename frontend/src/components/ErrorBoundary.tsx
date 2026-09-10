import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Findstuff screen failed', error, info.componentStack); }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey?: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (this.state.failed) return <section className="empty-inline" role="alert"><h1>This screen could not open</h1><p>Your saved inventory is still available. Reconnect and reload to get the current version.</p><button onClick={() => window.location.reload()}>Reload Findstuff</button><a href="/?view=dashboard">Go to Home</a></section>;
    return this.props.children;
  }
}
