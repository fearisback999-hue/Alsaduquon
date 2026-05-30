'use client'

import { Suspense, lazy, Component, type ReactNode } from 'react'
const Spline = lazy(() => import('@splinetool/react-spline'))

interface SplineSceneProps {
  scene: string
  className?: string
  fallback?: ReactNode
}

/**
 * Spline loads the 3D scene over the network. If that fetch fails (offline,
 * firewall, CSP, rate limit), the runtime throws — which would crash the
 * whole page. This boundary catches it and renders a graceful fallback so
 * the rest of the UI stays alive.
 */
class SplineErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

function DefaultFallback() {
  return (
    <div className="w-full h-full flex items-center justify-center relative overflow-hidden">
      {/* Animated gradient orb stand-in for the 3D scene */}
      <div className="absolute w-72 h-72 rounded-full bg-gradient-to-br from-indigo-500/30 via-purple-500/20 to-transparent blur-3xl animate-float" />
      <div className="absolute w-48 h-48 rounded-full bg-gradient-to-tr from-purple-600/20 to-indigo-400/10 blur-2xl animate-float" style={{ animationDelay: '1.2s' }} />
    </div>
  )
}

export function SplineScene({ scene, className, fallback }: SplineSceneProps) {
  const fb = fallback ?? <DefaultFallback />
  return (
    <SplineErrorBoundary fallback={fb}>
      <Suspense
        fallback={
          <div className="w-full h-full flex items-center justify-center">
            <DefaultFallback />
          </div>
        }
      >
        <Spline scene={scene} className={className} />
      </Suspense>
    </SplineErrorBoundary>
  )
}
