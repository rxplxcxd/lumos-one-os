import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';
import { goHome } from '@/store/ui.js';

export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[lumos] screen crashed', error, info.componentStack);
    this.props.onError?.(error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    if ('fallback' in this.props) return this.props.fallback; // e.g. inside a WebGL scene
    return (
      <div data-nav-scope="0" className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
        <AlertTriangle className="h-10 w-10 text-warn" />
        <div className="text-lg font-semibold">Diese Ansicht ist abgestürzt</div>
        <div className="max-w-[36rem] text-[0.8rem] text-mist-400">{String(this.state.error?.message || this.state.error)}</div>
        <button data-nav="" data-nav-autofocus="" className="nav-focus glass rounded-2xl px-5 py-2.5" onClick={() => (this.setState({ error: null }), goHome())}>
          Zum Startbildschirm
        </button>
      </div>
    );
  }
}
