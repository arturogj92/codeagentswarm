const Sentry = require('@sentry/electron/renderer');
const React = require('react');

// Initialize Sentry for renderer process
function initSentryRenderer() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN || '', // Add your Sentry DSN here
    environment: process.env.NODE_ENV || 'production',
    integrations: [
      new Sentry.BrowserTracing({
        // Set sampling rate for performance monitoring
        tracePropagationTargets: ['localhost', /^\//],
      }),
    ],
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    beforeSend(event, hint) {
      // Filter out certain errors if needed
      if (process.env.NODE_ENV === 'development') {
        console.log('[Sentry Renderer] Event captured:', event.event_id);
      }
      return event;
    },
  });
}

// Error boundary component for React (if you use React in the renderer)
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: errorInfo.componentStack,
        },
      },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-fallback">
          <h2>Something went wrong</h2>
          <details style={{ whiteSpace: 'pre-wrap' }}>
            {this.state.error && this.state.error.toString()}
          </details>
          <button onClick={() => window.location.reload()}>
            Reload Application
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Export functions and components
module.exports = {
  initSentryRenderer,
  ErrorBoundary,
  Sentry,
};