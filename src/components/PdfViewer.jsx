import { useEffect, useRef, useState } from 'react'
import { loadPdfjs } from '../formReader.js'

// Full-screen PDF viewer. Renders pages to <canvas> with pdf.js instead of an
// <iframe>/<embed> — iOS Safari refuses to render PDFs inline, which is why
// the forms "didn't show up" on phones. Works the same on every device.

function PdfPage({ doc, num, availWidth, zoom }) {
  const canvasRef = useRef(null)
  const taskRef = useRef(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const page = await doc.getPage(num)
        if (cancelled) return
        const unscaled = page.getViewport({ scale: 1 })
        const scale = Math.max(0.1, (availWidth / unscaled.width) * zoom)
        const viewport = page.getViewport({ scale })
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        taskRef.current?.cancel()
        taskRef.current = page.render({
          canvasContext: canvas.getContext('2d'),
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        })
        await taskRef.current.promise
      } catch (e) {
        if (!cancelled && e?.name !== 'RenderingCancelledException') {
          console.error('PDF page render failed', e)
          setFailed(true)
        }
      }
    })()
    return () => {
      cancelled = true
      taskRef.current?.cancel()
    }
  }, [doc, num, availWidth, zoom])

  return (
    <div className="mx-auto my-3 shadow-sm" style={{ width: 'fit-content', background: '#fff' }}>
      {failed ? (
        <p className="text-xs text-bad p-4">Couldn’t render page {num}.</p>
      ) : (
        <canvas ref={canvasRef} className="block" />
      )}
    </div>
  )
}

export default function PdfViewer({ url, name, onClose }) {
  const scrollRef = useRef(null)
  const [doc, setDoc] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [zoom, setZoom] = useState(1)
  const [availWidth, setAvailWidth] = useState(0)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const pdfjs = await loadPdfjs()
        const loaded = await pdfjs.getDocument(url).promise
        if (cancelled) return
        setDoc(loaded)
        setStatus('ready')
      } catch (e) {
        if (cancelled) return
        console.error('PDF load failed', e)
        setStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [url])

  // Track the usable width so pages render crisp and fit the viewport.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setAvailWidth(Math.max(0, el.clientWidth - 24))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [status])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ground">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-surface shrink-0">
        <span className="flex-1 min-w-0 truncate text-sm font-medium text-ink">{name || 'PDF'}</span>
        <button
          onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}
          className="w-8 h-8 rounded-lg border border-line-strong text-ink text-lg leading-none cursor-pointer disabled:opacity-40"
          disabled={status !== 'ready' || zoom <= 0.5}
          aria-label="Zoom out"
        >−</button>
        <span className="text-xs text-muted tabular-nums w-10 text-center">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))}
          className="w-8 h-8 rounded-lg border border-line-strong text-ink text-lg leading-none cursor-pointer disabled:opacity-40"
          disabled={status !== 'ready' || zoom >= 3}
          aria-label="Zoom in"
        >+</button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:inline-flex items-center h-8 px-3 rounded-lg border border-line-strong text-xs font-medium text-ink hover:bg-subtle"
        >
          Open ↗
        </a>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-lg bg-accent text-accent-ink text-lg leading-none cursor-pointer"
          aria-label="Close"
        >✕</button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto overscroll-contain px-3 py-2">
        {status === 'loading' && <p className="text-sm text-faint text-center mt-10">Loading PDF…</p>}
        {status === 'error' && (
          <div className="text-center mt-10">
            <p className="text-sm text-bad">Couldn’t open this PDF.</p>
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline mt-2 inline-block">
              Try opening it in a new tab
            </a>
          </div>
        )}
        {status === 'ready' && doc && availWidth > 0 &&
          Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage key={i + 1} doc={doc} num={i + 1} availWidth={availWidth} zoom={zoom} />
          ))}
      </div>
    </div>
  )
}
