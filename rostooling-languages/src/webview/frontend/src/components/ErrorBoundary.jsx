import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('RosTooling Studio caught visual error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="rt-error-boundary-fallback"
          style={{
            padding: 20,
            background: 'var(--rt-surface-2, #1e293b)',
            color: '#f8fafc',
            borderRadius: 8,
            margin: 16,
            border: '1px solid #ef4444',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <AlertCircle size={20} style={{ color: '#ef4444', flexShrink: 0 }} />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
              Visual Canvas Rendering Interrupted
            </h3>
          </div>
          <p style={{ margin: '0 0 12px', fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.5 }}>
            {this.state.error?.message || 'An unexpected rendering error occurred in this view.'}
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="rt-btn primary"
              style={{ padding: '6px 14px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={this.handleReset}
            >
              <RefreshCw size={13} /> Recover Canvas
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
