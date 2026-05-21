import React, { useEffect, useMemo, useState } from 'react';

const LINE_DATA = {
  '400': { label: '400 kV normalised line', vBase: 400, r100: 0.00161, x100: 0.01729, b100: 0.66554 },
  '220': { label: '220 kV normalised line', vBase: 220, r100: 0.00956, x100: 0.06518, b100: 0.17790 },
};

const C = (re = 0, im = 0) => ({ re, im });
const add = (a, b) => C(a.re + b.re, a.im + b.im);
const sub = (a, b) => C(a.re - b.re, a.im - b.im);
const mul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a, b) => {
  const den = b.re * b.re + b.im * b.im;
  return den === 0 ? C(NaN, NaN) : C((a.re * b.re + a.im * b.im) / den, (a.im * b.re - a.re * b.im) / den);
};
const conj = (a) => C(a.re, -a.im);
const mag = (a) => Math.hypot(a.re, a.im);
const angle = (a) => Math.atan2(a.im, a.re) * 180 / Math.PI;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const fmt = (x, d = 3) => Number.isFinite(x) ? x.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';

function solveLine({ vs, p, q, r, x, b }) {
  const Vs = C(vs, 0);
  const Z = C(r, x);
  const Yh = C(0, b / 2);
  const S = C(p, q);
  let Vr = C(Math.max(0.6, vs), -0.02);
  let converged = false;

  for (let k = 0; k < 500; k += 1) {
    const Il = conj(div(S, Vr));
    const next = div(sub(Vs, mul(Z, Il)), add(C(1, 0), mul(Z, Yh)));
    if (!Number.isFinite(next.re) || !Number.isFinite(next.im)) break;
    const err = mag(sub(next, Vr));
    Vr = C(0.55 * Vr.re + 0.45 * next.re, 0.55 * Vr.im + 0.45 * next.im);
    if (mag(Vr) < 0.05 || mag(Vr) > 3.0) break;
    if (err < 1e-10) { converged = true; break; }
  }

  const finite = Number.isFinite(Vr.re) && Number.isFinite(Vr.im) && mag(Vr) > 0.05 && mag(Vr) < 3.0;
  if (!finite) return { converged: false, drawable: false };

  const Il = conj(div(S, Vr));
  const IrSh = mul(Yh, Vr);
  const Iser = add(Il, IrSh);
  const Is = add(Iser, mul(Yh, Vs));
  const Ss = mul(Vs, conj(Is));
  const Sl = mul(Vr, conj(Il));
  const qSeries = mag(Iser) ** 2 * x;
  const qShS = -(mag(Vs) ** 2) * b / 2;
  const qShR = -(mag(Vr) ** 2) * b / 2;
  const zc = b > 0 && x > 0 ? Math.sqrt(x / b) : NaN;

  return {
    converged,
    drawable: true,
    vr: mag(Vr),
    delta: angle(Vs) - angle(Vr),
    is: mag(Is),
    iser: mag(Iser),
    ss: Ss,
    loss: Ss.re - Sl.re,
    qLine: Ss.im - Sl.im,
    qSeries,
    qShS,
    qShR,
    zc,
    sil: Number.isFinite(zc) && zc > 0 ? 1 / zc : NaN,
  };
}

function NumberControl({ label, value, setValue, min, max, step, unit, hint }) {
  return <div className="control">
    <div className="controlTop"><div><label>{label}</label>{hint && <div className="hint">{hint}</div>}</div>
      <div className="num"><input type="number" value={value} min={min} max={max} step={step} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setValue(clamp(n, min, max)); }} /><span>{unit}</span></div></div>
    <input type="range" value={value} min={min} max={max} step={step} onChange={(e) => setValue(Number(e.target.value))} />
  </div>;
}

function Metric({ label, value, unit }) {
  return <div className="metric"><div className="metricLabel">{label}</div><div className="metricValue">{value} <span>{unit}</span></div></div>;
}

function Chart({ data, yKey, yLabel, title, pLoadMW, pMaxMW, yZero = 0 }) {
  const [xmin, setXmin] = useState(0);
  const [xmax, setXmax] = useState(pMaxMW);
  useEffect(() => { setXmin(0); setXmax(pMaxMW); }, [pMaxMW, title]);

  const zoom = (f) => {
    const mid = (xmin + xmax) / 2;
    const span = clamp((xmax - xmin) * f, Math.max(pMaxMW * 0.02, 1), pMaxMW);
    let a = mid - span / 2;
    let b = mid + span / 2;
    if (a < 0) { b -= a; a = 0; }
    if (b > pMaxMW) { a -= b - pMaxMW; b = pMaxMW; }
    setXmin(clamp(a, 0, pMaxMW)); setXmax(clamp(b, 0, pMaxMW));
  };
  const pan = (frac) => {
    const span = xmax - xmin;
    let a = xmin + span * frac;
    let b = xmax + span * frac;
    if (a < 0) { b -= a; a = 0; }
    if (b > pMaxMW) { a -= b - pMaxMW; b = pMaxMW; }
    setXmin(clamp(a, 0, pMaxMW)); setXmax(clamp(b, 0, pMaxMW));
  };

  const w = 820, h = 390, pad = { l: 86, r: 26, t: 28, b: 62 };
  const visible = data.filter((d) => d.pMW >= xmin && d.pMW <= xmax);
  const ys = visible.map((d) => d[yKey]).filter(Number.isFinite);
  let ymin = ys.length ? Math.min(...ys, yZero) : 0;
  let ymax = ys.length ? Math.max(...ys, yZero) : 1;
  if (Math.abs(ymax - ymin) < 1e-9) { ymin -= 1; ymax += 1; }
  const ypad = 0.08 * (ymax - ymin); ymin -= ypad; ymax += ypad;
  const sx = (x) => pad.l + (x - xmin) / (xmax - xmin || 1) * (w - pad.l - pad.r);
  const sy = (y) => pad.t + (h - pad.t - pad.b) - (y - ymin) / (ymax - ymin || 1) * (h - pad.t - pad.b);

  const segments = [];
  let current = [];
  visible.forEach((d) => {
    if (Number.isFinite(d[yKey])) current.push(d);
    else if (current.length) { segments.push(current); current = []; }
  });
  if (current.length) segments.push(current);

  const bands = [];
  let start = null;
  visible.forEach((d, i) => {
    const bad = d.unstable && Number.isFinite(d[yKey]);
    if (bad && start === null) start = d.pMW;
    if (start !== null && (!bad || i === visible.length - 1)) {
      const end = bad && i === visible.length - 1 ? d.pMW : visible[Math.max(0, i - 1)].pMW;
      bands.push([start, end]); start = null;
    }
  });

  const xticks = Array.from({ length: 6 }, (_, i) => xmin + (xmax - xmin) * i / 5);
  const yticks = Array.from({ length: 5 }, (_, i) => ymin + (ymax - ymin) * i / 4);

  return <div className="chart">
    <div className="chartHeader"><strong>{title}</strong><div className="tools"><button onClick={() => pan(-0.25)}>←</button><button onClick={() => pan(0.25)}>→</button><button onClick={() => zoom(0.5)}>Zoom in</button><button onClick={() => zoom(2)}>Zoom out</button><button onClick={() => { setXmin(0); setXmax(pMaxMW); }}>Reset</button></div></div>
    <div className="range"><label>From MW <input value={fmt(xmin, 0)} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n < xmax) setXmin(clamp(n, 0, pMaxMW)); }} /></label><label>To MW <input value={fmt(xmax, 0)} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n > xmin) setXmax(clamp(n, 0, pMaxMW)); }} /></label></div>
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title}>
      <rect x="0" y="0" width={w} height={h} fill="white" />
      <rect x={pad.l} y={pad.t} width={w - pad.l - pad.r} height={h - pad.t - pad.b} className="plotBg" />
      {bands.map(([a, b], i) => <rect key={i} x={sx(a)} y={pad.t} width={Math.max(0, sx(b) - sx(a))} height={h - pad.t - pad.b} className="badBand" />)}
      {yticks.map((t) => <g key={`y${t}`}><line x1={pad.l} x2={w - pad.r} y1={sy(t)} y2={sy(t)} className="gridLine" /><text x={pad.l - 10} y={sy(t) + 4} textAnchor="end" className="tick">{fmt(t, 2)}</text></g>)}
      {xticks.map((t) => <g key={`x${t}`}><line x1={sx(t)} x2={sx(t)} y1={pad.t} y2={h - pad.b} className="gridLine" /><text x={sx(t)} y={h - pad.b + 24} textAnchor="middle" className="tick">{fmt(t, 0)}</text></g>)}
      {yZero >= ymin && yZero <= ymax && <line x1={pad.l} x2={w - pad.r} y1={sy(yZero)} y2={sy(yZero)} className="marker" />}
      {pLoadMW >= xmin && pLoadMW <= xmax && <line x1={sx(pLoadMW)} x2={sx(pLoadMW)} y1={pad.t} y2={h - pad.b} className="marker" />}
      {segments.map((seg, i) => <path key={i} className="curve" d={seg.map((d, j) => `${j ? 'L' : 'M'} ${sx(d.pMW).toFixed(2)} ${sy(d[yKey]).toFixed(2)}`).join(' ')} />)}
      <line x1={pad.l} x2={w - pad.r} y1={h - pad.b} y2={h - pad.b} className="axis" /><line x1={pad.l} x2={pad.l} y1={pad.t} y2={h - pad.b} className="axis" />
      <text x={(pad.l + w - pad.r) / 2} y={h - 16} textAnchor="middle" className="axisLabel">Receiving-end real load P (MW)</text>
      <text x="18" y={(pad.t + h - pad.b) / 2} transform={`rotate(-90 18 ${(pad.t + h - pad.b) / 2})`} textAnchor="middle" className="axisLabel">{yLabel}</text>
    </svg>
  </div>;
}

export default function App() {
  const [lineKey, setLineKey] = useState('400');
  const [length, setLength] = useState(300);
  const [sBase, setSBase] = useState(100);
  const [vs, setVs] = useState(1.0);
  const [p, setP] = useState(3.0);
  const [q, setQ] = useState(0.0);
  const [pMax, setPMax] = useState(8.0);
  const [tab, setTab] = useState('balance');

  const line = LINE_DATA[lineKey];
  const scale = length / 100;
  const r = line.r100 * scale, x = line.x100 * scale, b = line.b100 * scale;
  const res = useMemo(() => solveLine({ vs, p, q, r, x, b }), [vs, p, q, r, x, b]);
  const mw = (pu) => pu * sBase;
  const kv = (pu) => pu * line.vBase;

  const sweep = useMemo(() => {
    const out = [];
    for (let i = 0; i <= 260; i += 1) {
      const pp = pMax * i / 260;
      const rr = solveLine({ vs, p: pp, q, r, x, b });
      out.push({ pMW: pp * sBase, qMVAr: rr.drawable ? rr.qLine * sBase : null, vr: rr.drawable ? rr.vr : null, unstable: !rr.converged });
    }
    return out;
  }, [vs, q, r, x, b, pMax, sBase]);

  const qStatus = !res.converged ? 'non-converged operating point' : Math.abs(res.qLine) < 5e-4 ? 'approximately reactive-neutral' : res.qLine > 0 ? 'net reactive absorption' : 'net reactive injection';
  const vStatus = !res.drawable ? 'voltage not solved' : res.vr > 1.005 ? 'receiving-end voltage rise' : res.vr < 0.995 ? 'receiving-end voltage drop' : 'near-flat voltage profile';

  return <div className="page"><style>{CSS}</style><div className="wrap">
    <header><h1>Per-unit transmission-line reactive power applet</h1><div className="badges"><span>{qStatus}</span><span>{vStatus}</span></div><p>Balanced three-phase nominal-π model in per unit. Positive line reactive power means net absorption by the isolated line; negative line reactive power means net capacitive injection.</p></header>
    <div className="layout"><aside className="card controls"><h2>Inputs</h2>
      <div className="control"><label>Standard line</label><select value={lineKey} onChange={(e) => setLineKey(e.target.value)}><option value="400">400 kV normalised line</option><option value="220">220 kV normalised line</option></select><div className="hint">Base voltage: {line.vBase} kV line-to-line.</div></div>
      <NumberControl label="System power base" value={sBase} setValue={setSBase} min={50} max={1000} step={10} unit="MVA" hint="Used to display MW and MVAr" />
      <NumberControl label="Line length" value={length} setValue={setLength} min={10} max={800} step={10} unit="km" hint="R, X, and B scale linearly" />
      <NumberControl label="Sending-end voltage" value={vs} setValue={setVs} min={0.85} max={1.4} step={0.005} unit="p.u." hint={`${fmt(kv(vs), 1)} kV line-to-line`} />
      <NumberControl label="Receiving-end real load" value={p} setValue={setP} min={0} max={10} step={0.05} unit="p.u." hint={`${fmt(mw(p), 1)} MW`} />
      <NumberControl label="Receiving-end reactive load" value={q} setValue={setQ} min={-5} max={6} step={0.05} unit="p.u." hint={`${fmt(mw(q), 1)} MVAr; positive = inductive`} />
      <NumberControl label="Sweep maximum load" value={pMax} setValue={setPMax} min={1} max={12} step={0.1} unit="p.u." hint={`${fmt(mw(pMax), 0)} MW on this base`} />
    </aside>
    <main className="main"><section className="card"><h2>Scaled line parameters</h2><div className="metrics"><Metric label="R" value={fmt(r, 5)} unit="p.u." /><Metric label="X" value={fmt(x, 5)} unit="p.u." /><Metric label="B" value={fmt(b, 5)} unit="p.u." /><Metric label="Length factor" value={fmt(scale, 2)} unit="×100 km" /></div><p className="small">400 kV: R=0.00161, X=0.01729, B=0.66554 p.u./100 km. 220 kV: R=0.00956, X=0.06518, B=0.17790 p.u./100 km.</p></section>
      <section className="metrics"><Metric label="Receiving voltage" value={res.drawable ? fmt(res.vr, 4) : '—'} unit="p.u." /><Metric label="Receiving voltage" value={res.drawable ? fmt(kv(res.vr), 1) : '—'} unit="kV" /><Metric label="Angle difference" value={res.drawable ? fmt(res.delta, 2) : '—'} unit="deg" /><Metric label="Series current" value={res.drawable ? fmt(res.iser, 3) : '—'} unit="p.u." /><Metric label="Sending-end P" value={res.drawable ? fmt(res.ss.re, 4) : '—'} unit="p.u." /><Metric label="Sending-end Q" value={res.drawable ? fmt(res.ss.im, 4) : '—'} unit="p.u." /><Metric label="Line real loss" value={res.drawable ? fmt(res.loss, 5) : '—'} unit="p.u." /><Metric label="Line net Q" value={res.drawable ? fmt(res.qLine, 5) : '—'} unit="p.u." /></section>
      <section className="card"><div className="tabs">{[['balance', 'Reactive balance'], ['q', 'Q sweep'], ['v', 'Voltage sweep'], ['notes', 'Model notes']].map(([k, text]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{text}</button>)}</div>
        {tab === 'balance' && <div className="stack"><div className="metrics"><Metric label="Series absorption" value={res.drawable ? fmt(res.qSeries, 5) : '—'} unit="p.u." /><Metric label="Sending shunt injection" value={res.drawable ? fmt(res.qShS, 5) : '—'} unit="p.u." /><Metric label="Receiving shunt injection" value={res.drawable ? fmt(res.qShR, 5) : '—'} unit="p.u." /><Metric label="Line net Q" value={res.drawable ? fmt(mw(res.qLine), 2) : '—'} unit="MVAr" /></div><div className="identity"><strong>Line-only reactive-power identity</strong><br />Q_line = Q_series + Q_shunt,sending + Q_shunt,receiving<div className="mono">{res.drawable ? `${fmt(res.qLine, 5)} = ${fmt(res.qSeries, 5)} + (${fmt(res.qShS, 5)}) + (${fmt(res.qShR, 5)}) p.u.` : 'No finite operating point.'}</div></div><div className="metrics"><Metric label="Approx. surge impedance" value={res.drawable ? fmt(res.zc, 3) : '—'} unit="p.u." /><Metric label="Approx. SIL" value={res.drawable ? fmt(res.sil, 3) : '—'} unit="p.u." /><Metric label="Approx. SIL" value={res.drawable ? fmt(mw(res.sil), 1) : '—'} unit="MW" /><Metric label="Selected load" value={fmt(mw(p), 1)} unit="MW" /></div></div>}
        {tab === 'q' && <><Chart data={sweep} yKey="qMVAr" yLabel="Line net Q (MVAr)" title="Load sweep: line reactive absorption/injection" pLoadMW={mw(p)} pMaxMW={mw(pMax)} yZero={0} /><p className="small">Grey regions indicate non-converged operating points; plotted values there are last finite iterative estimates and should be interpreted qualitatively.</p></>}
        {tab === 'v' && <><Chart data={sweep} yKey="vr" yLabel="Receiving-end voltage V_R (p.u.)" title="Load sweep: receiving-end voltage" pLoadMW={mw(p)} pMaxMW={mw(pMax)} yZero={1} /><p className="small">Light-load voltage rise corresponds to the Ferranti-effect region. Grey regions indicate numerical instability or non-convergence.</p></>}
        {tab === 'notes' && <div className="small"><strong>Assumptions</strong><ul><li>Balanced three-phase steady-state phasor model.</li><li>Nominal-π equivalent: total series impedance Z = R + jX and total shunt admittance jB split equally at both ends.</li><li>The receiving-end load is a constant complex-power load.</li><li>For very long lines, a distributed-parameter model is more accurate than the nominal-π approximation.</li></ul></div>}
      </section></main></div></div></div>;
}

const CSS = `
*{box-sizing:border-box} body{margin:0}.page{min-height:100vh;background:#f6f7fb;color:#111827;padding:24px;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:1240px;margin:0 auto;display:flex;flex-direction:column;gap:18px}h1{font-size:clamp(26px,4vw,42px);line-height:1.05;margin:0;letter-spacing:-.035em}h2{font-size:18px;margin:0 0 12px}p{margin:0;color:#4b5563;line-height:1.55}.badges{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.badges span{border:1px solid #d1d5db;background:white;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700}.layout{display:grid;grid-template-columns:360px minmax(0,1fr);gap:18px}.card{background:white;border:1px solid #e5e7eb;border-radius:22px;box-shadow:0 10px 28px rgba(15,23,42,.06);padding:18px;min-width:0}.controls,.main,.stack{display:flex;flex-direction:column;gap:16px}.control{display:flex;flex-direction:column;gap:8px}.controlTop{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}label{font-size:13px;font-weight:750}.hint,.small{color:#6b7280;font-size:13px;line-height:1.5}.num{display:flex;align-items:center;gap:6px}.num input{width:92px;height:32px;border:1px solid #d1d5db;border-radius:10px;padding:4px 8px;text-align:right}.num span{width:48px;color:#6b7280;font-size:12px}input[type=range]{width:100%}select{width:100%;height:38px;border:1px solid #d1d5db;border-radius:12px;padding:0 10px;background:white;font-weight:650}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.metric{border:1px solid #e5e7eb;background:#fbfdff;border-radius:18px;padding:12px;min-height:76px;min-width:0}.metricLabel{color:#6b7280;font-size:12px;margin-bottom:8px}.metricValue{font-size:20px;font-weight:800;overflow-wrap:anywhere}.metricValue span{color:#6b7280;font-size:12px;font-weight:600}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}.tabs button,.tools button{border:1px solid #d1d5db;background:#f9fafb;border-radius:999px;padding:8px 12px;font-size:13px;font-weight:750;cursor:pointer}.tabs button.active{background:#111827;color:white;border-color:#111827}.identity{border:1px solid #e5e7eb;background:#fbfdff;border-radius:18px;padding:16px;line-height:1.6}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:13px;background:#f3f4f6;border-radius:12px;padding:10px;margin-top:10px;overflow-x:auto}.chart{width:100%;max-width:100%;min-width:0;overflow:hidden}.chartHeader{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px}.tools{display:flex;gap:6px;flex-wrap:wrap}.tools button:hover{background:#eef2ff}.range{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;color:#4b5563;font-size:12px;font-weight:700}.range input{width:92px;margin-left:6px;border:1px solid #d1d5db;border-radius:9px;padding:4px 7px;text-align:right}svg{display:block;width:100%;height:auto;max-width:100%}.plotBg{fill:#fbfdff;stroke:#e5e7eb}.badBand{fill:#9ca3af;opacity:.22}.gridLine{stroke:#e5e7eb;stroke-width:1}.axis{stroke:#111827;stroke-width:1.2}.curve{fill:none;stroke:#111827;stroke-width:2.6}.marker{stroke:#ef4444;stroke-width:1.4;stroke-dasharray:6 5}.tick{font-size:11px;fill:#6b7280}.axisLabel{font-size:12px;font-weight:700;fill:#374151}ul{margin:8px 0 0;padding-left:20px}li{margin-bottom:6px}@media(max-width:980px){.layout{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.page{padding:14px}.metrics{grid-template-columns:1fr}.controlTop{flex-direction:column}}
`;
