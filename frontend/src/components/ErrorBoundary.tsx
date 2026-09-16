import { Component, type ErrorInfo, type ReactNode } from "react";
import { Icon } from "./Icon";

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Findstuff screen failed', error, info.componentStack); }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey?: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (this.state.failed) return (
      <section className="screen-failure" role="alert">
        <span className="screen-failure-mark" aria-hidden="true"><Icon name="box" size={26} /></span>
        <h1>This screen could not open</h1>
        <p>Your saved inventory is still on this device. Reload to fetch the current version, or carry on somewhere else.</p>
        <div className="button-row">
          <button className="primary" onClick={() => window.location.reload()}>Reload Findstuff</button>
          <a className="outline-button" href="/?view=dashboard">Go to Home</a>
        </div>
      </section>
    );
    return this.props.children;
  }
}
