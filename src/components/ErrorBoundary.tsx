import { Component, Fragment, type ReactNode } from 'react'
import { storageError } from '../lib/errors'

export class ErrorBoundary extends Component<{ children: ReactNode; title: string; reload?: boolean }> {
  state = { failed: false, error: '', attempt: 0 }

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error: storageError(error) }
  }

  render() {
    if (this.state.failed) return <section className="empty-state">
      <h2>{this.props.title}</h2>
      <p role="alert">{this.state.error}</p>
      <button className="button button--primary" type="button" onClick={() => {
        if (this.props.reload) window.location.reload()
        else this.setState(({ attempt }: typeof this.state) => ({ failed: false, error: '', attempt: attempt + 1 }))
      }}>{this.props.reload ? 'Reload app' : 'Retry'}</button>
    </section>
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
  }
}
