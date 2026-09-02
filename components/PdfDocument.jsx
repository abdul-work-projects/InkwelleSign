'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Spinner } from './ui.jsx';

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/build/pdf.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      return lib;
    });
  }
  return pdfjsPromise;
}

function PdfPage({ page, width, children, pageNumber, onPageRef }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const taskRef = useRef(null);
  const viewport = page.getViewport({ scale: 1 });
  const height = (width / viewport.width) * viewport.height;

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = (width / viewport.width) * dpr;
    const vp = page.getViewport({ scale });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    const ctx = canvas.getContext('2d', { alpha: false });
    taskRef.current?.cancel?.();
    const task = page.render({ canvasContext: ctx, viewport: vp, background: '#ffffff' });
    taskRef.current = task;
    task.promise.catch((err) => { if (!cancelled && err?.name !== 'RenderingCancelledException') console.error(err); });
    return () => { cancelled = true; task.cancel?.(); };
  }, [page, width, viewport.width]);

  useLayoutEffect(() => {
    onPageRef?.(pageNumber, wrapRef.current);
  }, [pageNumber, onPageRef]);

  return (
    <div
      ref={wrapRef}
      data-page={pageNumber}
      className="relative bg-white shadow-card ring-1 ring-ink-200/80 rounded-[2px] mx-auto"
      style={{ width, height }}
    >
      <canvas ref={canvasRef} className="block rounded-[2px]" />
      {children}
    </div>
  );
}

/**
 * Renders a PDF as a vertical stack of pages sized to the container width.
 * `renderOverlay(pageNumber, { width, height })` lets callers draw absolutely
 * positioned field chips on top of each page using normalised coordinates.
 */
export default function PdfDocument({ url, renderOverlay, maxWidth = 900, className, onLoad, onPageRef }) {
  const containerRef = useRef(null);
  const [pages, setPages] = useState([]);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let doc;
    setLoading(true); setError(null);
    loadPdfjs()
      .then((lib) => lib.getDocument({ url, withCredentials: true }).promise)
      .then(async (pdf) => {
        if (cancelled) return;
        doc = pdf;
        const list = [];
        for (let i = 1; i <= pdf.numPages; i++) list.push(await pdf.getPage(i));
        if (cancelled) return;
        setPages(list);
        setLoading(false);
        onLoad?.({ pageCount: pdf.numPages, sizes: list.map((p) => {
          const v = p.getViewport({ scale: 1 });
          return { w: v.width, h: v.height };
        }) });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || 'The document could not be displayed');
        setLoading(false);
      });
    return () => { cancelled = true; doc?.destroy?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(Math.min(el.clientWidth, maxWidth));
  }, [maxWidth]);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div ref={containerRef} className={className}>
      {loading && (
        <div className="flex items-center justify-center gap-2 py-20 text-ink-500 text-sm">
          <Spinner /> Rendering document…
        </div>
      )}
      {error && (
        <div className="mx-auto max-w-md rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}
      <div className="space-y-5">
        {!!width && pages.map((page, i) => {
          const vp = page.getViewport({ scale: 1 });
          const h = (width / vp.width) * vp.height;
          return (
            <PdfPage key={i} page={page} width={width} pageNumber={i + 1} onPageRef={onPageRef}>
              {renderOverlay?.(i + 1, { width, height: h })}
            </PdfPage>
          );
        })}
      </div>
    </div>
  );
}
