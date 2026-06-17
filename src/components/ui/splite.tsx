'use client'

import { useRef, useEffect, useState, useCallback, Component, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SplineSceneProps {
  scene: string
  className?: string
  fallback?: ReactNode
}

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
      <div className="absolute w-72 h-72 rounded-full bg-gradient-to-br from-indigo-500/30 via-purple-500/20 to-transparent blur-3xl animate-float" />
      <div className="absolute w-48 h-48 rounded-full bg-gradient-to-tr from-purple-600/20 to-indigo-400/10 blur-2xl animate-float" style={{ animationDelay: '1.2s' }} />
    </div>
  )
}

function SplineCanvas({ scene, className }: { scene: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const appRef = useRef<any>(null)
  const [loaded, setLoaded] = useState(false)

  const initScene = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || appRef.current) return

    try {
      const { Application } = await import('@splinetool/runtime')
      const app = new Application(canvas)
      appRef.current = app
      await app.load(scene)
      setLoaded(true)
    } catch {
      // Swallowed — error boundary or unhandledrejection handler picks it up
    }
  }, [scene])

  useEffect(() => {
    // Cap canvas resolution to 1.5x DPR for performance
    const canvas = canvasRef.current
    const container = containerRef.current
    if (canvas && container) {
      const dpr = Math.min(window.devicePixelRatio, 1.5)
      const rect = container.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
    }

    // Defer Spline load until after first paint
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(() => initScene(), { timeout: 1500 })
      return () => cancelIdleCallback(id)
    }
    const timer = setTimeout(initScene, 100)
    return () => clearTimeout(timer)
  }, [initScene])

  useEffect(() => {
    return () => {
      appRef.current?.dispose?.()
      appRef.current = null
    }
  }, [])

  return (
    <div ref={containerRef} className={cn('relative w-full h-full', className)}>
      {!loaded && <DefaultFallback />}
      <canvas
        ref={canvasRef}
        className={cn(
          'w-full h-full transition-opacity duration-700',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  )
}

export function SplineScene({ scene, className, fallback }: SplineSceneProps) {
  const fb = fallback ?? <DefaultFallback />
  return (
    <SplineErrorBoundary fallback={fb}>
      <SplineCanvas scene={scene} className={className} />
    </SplineErrorBoundary>
  )
}
