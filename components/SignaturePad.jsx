'use client';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Type, PenTool, Upload, Trash2 } from 'lucide-react';
import { Button, Modal } from './ui.jsx';

const SCRIPTS = [
  { key: 'sig1', label: 'Roundhand', css: '"Snell Roundhand", "Segoe Script", "Brush Script MT", cursive', style: '' },
  { key: 'sig2', label: 'Classic', css: '"Palatino Linotype", "Book Antiqua", Palatino, serif', style: 'italic ' },
  { key: 'sig3', label: 'Casual', css: '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive', style: '' },
];

const CANVAS_W = 720;
const CANVAS_H = 240;

/** Crops transparent margins so the stamped image fills its field box. */
function trimToContent(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 6;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function DrawSurface({ canvasRef, onChange }) {
  const drawing = useRef(false);
  const last = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#12203a';
  }, [canvasRef]);

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const point = e.touches?.[0] || e;
    return {
      x: ((point.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((point.clientY - rect.top) / rect.height) * CANVAS_H,
    };
  };

  const start = (e) => { e.preventDefault(); drawing.current = true; last.current = pos(e); };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.quadraticCurveTo(last.current.x, last.current.y, (last.current.x + p.x) / 2, (last.current.y + p.y) / 2);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    onChange?.();
  };
  const end = () => { drawing.current = false; last.current = null; };

  return (
    <canvas
      ref={canvasRef}
      className="w-full aspect-[3/1] rounded-lg bg-white border border-dashed border-ink-300 touch-none cursor-crosshair"
      onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
      onTouchStart={start} onTouchMove={move} onTouchEnd={end}
    />
  );
}

export default function SignaturePad({ open, onClose, onApply, defaultName = '', kind = 'signature' }) {
  const [tab, setTab] = useState('type');
  const [text, setText] = useState('');
  const [script, setScript] = useState(SCRIPTS[0].key);
  const [uploaded, setUploaded] = useState(null);
  const [hasDrawing, setHasDrawing] = useState(false);
  const [error, setError] = useState(null);
  const drawRef = useRef(null);

  const initial = kind === 'initials'
    ? defaultName.split(/\s+/).map((s) => s[0]).join('').toUpperCase().slice(0, 4)
    : defaultName;

  useEffect(() => {
    if (open) { setText(initial); setError(null); setUploaded(null); setHasDrawing(false); setTab('type'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function renderTyped() {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W; canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    const font = SCRIPTS.find((s) => s.key === script) || SCRIPTS[0];
    let size = 96;
    ctx.fillStyle = '#12203a';
    ctx.textBaseline = 'middle';
    do {
      ctx.font = `${font.style}${size}px ${font.css}`;
      if (ctx.measureText(text).width <= CANVAS_W - 60) break;
      size -= 4;
    } while (size > 24);
    ctx.fillText(text, 30, CANVAS_H / 2);
    return canvas;
  }

  function apply() {
    setError(null);
    let source = null;
    let method = tab;
    if (tab === 'type') {
      if (!text.trim()) return setError('Enter your name to generate a signature');
      source = renderTyped();
      method = 'typed';
    } else if (tab === 'draw') {
      if (!hasDrawing) return setError('Draw your signature in the box above');
      source = drawRef.current;
      method = 'drawn';
    } else {
      if (!uploaded) return setError('Choose an image file to upload');
      source = uploaded;
      method = 'uploaded';
    }
    const trimmed = trimToContent(source) || source;
    const dataUrl = trimmed.toDataURL('image/png');
    if (dataUrl.length > 850_000) return setError('That image is too large. Try a smaller file.');
    onApply({ dataUrl, method });
    onClose();
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setError('Upload a PNG, JPEG or WebP image');
    if (file.size > 4 * 1024 * 1024) return setError('Image must be smaller than 4 MB');
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = CANVAS_W; canvas.height = CANVAS_H;
        const ctx = canvas.getContext('2d');
        const scale = Math.min(CANVAS_W / img.width, CANVAS_H / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (CANVAS_W - w) / 2, (CANVAS_H - h) / 2, w, h);
        setUploaded(canvas);
        setError(null);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  const tabs = [
    { key: 'type', label: 'Type', icon: Type },
    { key: 'draw', label: 'Draw', icon: PenTool },
    { key: 'upload', label: 'Upload', icon: Upload },
  ];

  return (
    <Modal
      open={open} onClose={onClose} width="max-w-xl"
      title={kind === 'initials' ? 'Add your initials' : 'Add your signature'}
      description="Your signature is applied to the document and recorded in the audit trail."
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={apply}>Apply {kind === 'initials' ? 'initials' : 'signature'}</Button>
      </>}
    >
      <div className="flex gap-1 p-1 bg-ink-100 rounded-lg mb-4">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => { setTab(key); setError(null); }}
            className={clsx(
              'flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md text-[13px] font-medium transition-colors',
              tab === key ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-800',
            )}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'type' && (
        <div className="space-y-3">
          <input
            value={text} onChange={(e) => setText(e.target.value)} maxLength={40}
            placeholder={kind === 'initials' ? 'AM' : 'Alex Moore'}
            className="w-full h-10 px-3 rounded-lg border border-ink-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/70 focus:border-brand-500"
          />
          <div className="grid grid-cols-3 gap-2">
            {SCRIPTS.map((s) => (
              <button key={s.key} onClick={() => setScript(s.key)}
                className={clsx(
                  'h-16 rounded-lg border bg-white flex items-center justify-center overflow-hidden px-2 transition-colors',
                  script === s.key ? 'border-brand-500 ring-2 ring-brand-500/25' : 'border-ink-200 hover:border-ink-300',
                )}>
                <span className="text-[26px] leading-none text-ink-900 truncate"
                  style={{ fontFamily: s.css, fontStyle: s.style ? 'italic' : 'normal' }}>
                  {text || (kind === 'initials' ? 'AM' : 'Signature')}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'draw' && (
        <div className="space-y-2">
          <DrawSurface canvasRef={drawRef} onChange={() => setHasDrawing(true)} />
          <div className="flex justify-between items-center">
            <p className="text-[12px] text-ink-500">Use a mouse, trackpad or finger.</p>
            <Button size="sm" variant="ghost" onClick={() => {
              const c = drawRef.current;
              c.getContext('2d').clearRect(0, 0, c.width, c.height);
              setHasDrawing(false);
            }}><Trash2 size={14} /> Clear</Button>
          </div>
        </div>
      )}

      {tab === 'upload' && (
        <div className="space-y-3">
          <label className="flex flex-col items-center justify-center gap-2 h-36 rounded-lg border border-dashed border-ink-300 bg-ink-50 cursor-pointer hover:border-brand-400 hover:bg-brand-50/40 transition-colors">
            <Upload size={18} className="text-ink-400" />
            <span className="text-[13px] text-ink-600">Choose a PNG, JPEG or WebP image</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFile} />
          </label>
          {uploaded && (
            <div className="rounded-lg border border-ink-200 bg-white p-3">
              <img alt="Uploaded signature preview" src={uploaded.toDataURL('image/png')} className="max-h-24 mx-auto" />
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-[13px] text-red-600">{error}</p>}
    </Modal>
  );
}
