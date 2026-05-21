import React, { useEffect, useMemo, useState } from 'react';

const LINE_DATA = {
  '400': { label: '400 kV normalised line', vBase: 400, r100: 0.00161, x100: 0.01729, b100: 0.66554 },
  '220': { label: '220 kV normalised line', vBase: 220, r100: 0.00956, x100: 0.06518, b100: 0.17790 },
};

const DEFAULTS = {
  lineKey: '400',
  length: 300,
  sBase: 100,
  vs: 1.0,
  p: 3.0,
  q: 0.0,
  pMax: 8.0,
  plotUnits: 'physical',
  fixedAxes: false,
  qMinPu: -5,
  qMaxPu: 5,
  qMinMVAr: -500,
  qMaxMVAr: 500,
  vMinPu: 0.8,
  vMaxPu: 1.4,
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
    <div className="controlTop">
      <div><label>{label}</label>{hint && <div className="hint">{hint}</div>}</div>
      <div className="num"><input type="number" value={value} min={min} max={max} step={step} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setValue(clamp(n, min, max)); }} /><span>{unit}</span></div>
    </div>
    <input type="range" value={value} min={min} max={max} step={step} onChange={(e) => setValue(Number(e.target.value))} />
  </div>;
}

function SmallNumber({ label, value, setValue, unit, step = 1 }) {
  return <label className="smallInput">{label}<input type="number" value={value} step={step} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setValue(n); }} /><span>{unit}</span></label>;
}

function Metric({ label, value, unit }) {
  return <div className="metric"><div className="metricLabel">{label}</div><div className="metricValue">{value} <span>{unit}</span></div></div>;
}

function Chart({ data, xKey, yKey, xLabel, yLabel, title, xMarker, xMax, yZero = 0, yTickDigits = 2, fixedY = false, yMinFixed, yMaxFixed }) {
  const [xmin, setXmin] = useState(0);
  const [xmax, setXmax] = useState(xMax);
  useEffect(() => { setXmin(0); setXmax(xMax); }, [xMax, xKey, title]);

  const zoom = (f) => {
    const mid = (xmin + xmax) / 2;
    const span = clamp((xmax - xmin) * f, Math.max(xMax * 0.02, 1e-6), xMax);
    let a = mid - span / 2;
    let b = mid + span / 2;
    if (a < 0) { b -= a; a = 0; }
    if (b > xMax) { a -= b - xMax; b = xMax; }
    setXmin(clamp(a, 0, xMax)); setXmax(clamp(b, 0, xMax));
  };
  const pan = (frac) => {
    const span = xmax - xmin;
    let a = xmin + span * frac;
    let b = xmax + span * frac;
    if (a < 0) { b -= a; a = 0; }
    if (b > xMax) { a -= b - xMax; b = xMax; }
    setXmin(clamp(a, 0, xMax)); setXmax(clamp(b, 0, xMax));
  };

  const w = 820, h = 390, pad = { l: 88, r: 26, t: 28, b: 62 };
  const visible = data.filter((d) => d[xKey] >= xmin && d[xKey] <= xmax);
  const ys = visible.map((d) => d[yKey]).filter(Number.isFinite);
  let ymin;
  let ymax;
  if (fixedY && Number.isFinite(yMinFixed) && Number.isFinite(yMaxFixed) && yMaxFixed > yMinFixed) {
    ymin = yMinFixed;
    ymax = yMaxFixed;
  } else {
    ymin = ys.length ? Math.min(...ys, yZero) : 0;
    ymax = ys.length ? Math.max(...ys, yZero) : 1;
    if (Math.abs(ymax - ymin) < 1e-9) { ymin -= 1; ymax += 1; }
    const ypad = 0.08 * (ymax - ymin); ymin -= ypad; ymax += ypad;
  }

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
    if (bad && start === null) start = d[xKey];
    if (start !== null && (!bad || i === visible.length - 1)) {
      const end = bad && i === visible.length - 1 ? d[xKey] : visible[Math.max(0, i - 1)][xKey];
      bands.push([start, end]); start = null;
    }
  });

  const xticks = Array.from({ length: 6 }, (_, i) => xmin + (xmax - xmin) * i / 5);
  const rawYticks = Array.from({ length: 5 }, (_, i) => ymin + (ymax - ymin) * i / 4);
  const yticks = Array.from(new Set([...rawYticks, yZero].map((t) => Number(t.toFixed(10)))))
    .filter((t) => t >= ymin && t <= ymax)
    .sort((a, b) => a - b);

  return <div className="chart">
    <div className="chartHeader"><strong>{title}</strong><div className="tools"><button onClick={() => pan(-0.25)}>←</button><button onClick={() => pan(0.25)}>→</button><button onClick={() => zoom(0.5)}>Zoom in</button><button onClick={() => zoom(2)}>Zoom out</button><button onClick={() => { setXmin(0); setXmax(xMax); }}>Reset view</button></div></div>
    <div className="range"><label>From <input value={fmt(xmin, xKey === 'pMW' ? 0 : 2)} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n < xmax) setXmin(clamp(n, 0, xMax)); }} /></label><label>To <input value={fmt(xmax, xKey === 'pMW' ? 0 : 2)} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n > xmin) setXmax(clamp(n, 0, xMax)); }} /></label></div>
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title}>
      <rect x="0" y="0" width={w} height={h} fill="white" />
      <rect x={pad.l} y={pad.t} width={w - pad.l - pad.r} height={h - pad.t - pad.b} className="plotBg" />
      {bands.map(([a, b], i) => <rect key={i} x={sx(a)} y={pad.t} width={Math.max(0, sx(b) - sx(a))} height={h - pad.t - pad.b} className="badBand" />)}
      {yticks.map((t) => <g key={`y${t}`}><line x1={pad.l} x2={w - pad.r} y1={sy(t)} y2={sy(t)} className="gridLine" /><text x={pad.l - 10} y={sy(t) + 4} textAnchor="end" className="tick">{fmt(t, yTickDigits)}</text></g>)}
      {xticks.map((t) => <g key={`x${t}`}><line x1={sx(t)} x2={sx(t)} y1={pad.t} y2={h - pad.b} className="gridLine" /><text x={sx(t)} y={h - pad.b + 24} textAnchor="middle" className="tick">{fmt(t, xKey === 'pMW' ? 0 : 2)}</text></g>)}
      {yZero >= ymin && yZero <= ymax && <line x1={pad.l} x2={w - pad.r} y1={sy(yZero)} y2={sy(yZero)} className="marker" />}
      {xMarker >= xmin && xMarker <= xmax && <line x1={sx(xMarker)} x2={sx(xMarker)} y1={pad.t} y2={h - pad.b} className="marker" />}
      {segments.map((seg, i) => <path key={i} className="curve" d={seg.map((d, j) => `${j ? 'L' : 'M'} ${sx(d[xKey]).toFixed(2)} ${sy(d[yKey]).toFixed(2)}`).join(' ')} />)}
      <line x1={pad.l} x2={w - pad.r} y1={h - pad.b} y2={h - pad.b} className="axis" /><line x1={pad.l} x2={pad.l} y1={pad.t} y2={h - pad.b} className="axis" />
      <text x={(pad.l + w - pad.r) / 2} y={h - 16} textAnchor="middle" className="axisLabel">{xLabel}</text>
      <text x="18" y={(pad.t + h - pad.b) / 2} transform={`rotate(-90 18 ${(pad.t + h - pad.b) / 2})`} textAnchor="middle" className="axisLabel">{yLabel}</text>
    </svg>
  </div>;
}

export default function App() {
  const [lineKey, setLineKey] = useState(DEFAULTS.lineKey);
  const [length, setLength] = useState(DEFAULTS.length);
  const [sBase, setSBase] = useState(DEFAULTS.sBase);
  const [vs, setVs] = useState(DEFAULTS.vs);
  const [p, setP] = useState(DEFAULTS.p);
  const [q, setQ] = useState(DEFAULTS.q);
  const [pMax, setPMax] = useState(DEFAULTS.pMax);
  const [tab, setTab] = useState('balance');
  const [plotUnits, setPlotUnits] = useState(DEFAULTS.plotUnits);
  const [fixedAxes, setFixedAxes] = useState(DEFAULTS.fixedAxes);
  const [qMinPu, setQMinPu] = useState(DEFAULTS.qMinPu);
  const [qMaxPu, setQMaxPu] = useState(DEFAULTS.qMaxPu);
  const [qMinMVAr, setQMinMVAr] = useState(DEFAULTS.qMinMVAr);
  const [qMaxMVAr, setQMaxMVAr] = useState(DEFAULTS.qMaxMVAr);
  const [vMinPu, setVMinPu] = useState(DEFAULTS.vMinPu);
  const [vMaxPu, setVMaxPu] = useState(DEFAULTS.vMaxPu);

  const resetDefaults = () => {
    setLineKey(DEFAULTS.lineKey); setLength(DEFAULTS.length); setSBase(DEFAULTS.sBase); setVs(DEFAULTS.vs);
    setP(DEFAULTS.p); setQ(DEFAULTS.q); setPMax(DEFAULTS.pMax); setPlotUnits(DEFAULTS.plotUnits);
    setFixedAxes(DEFAULTS.fixedAxes); setQMinPu(DEFAULTS.qMinPu); setQMaxPu(DEFAULTS.qMaxPu);
    setQMinMVAr(DEFAULTS.qMinMVAr); setQMaxMVAr(DEFAULTS.qMaxMVAr); setVMinPu(DEFAULTS.vMinPu); setVMaxPu(DEFAULTS.vMaxPu);
  };

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
      out.push({
        pPu: pp,
        pMW: pp * sBase,
        qPu: rr.drawable ? rr.qLine : null,
        qMVAr: rr.drawable ? rr.qLine * sBase : null,
        vr: rr.drawable ? rr.vr : null,
        unstable: !rr.converged,
      });
    }
    return out;
  }, [vs, q, r, x, b, pMax, sBase]);

  const xKey = plotUnits === 'physical' ? 'pMW' : 'pPu';
  const xLabel = plotUnits === 'physical' ? 'Receiving-end real load P (MW)' : 'Receiving-end real load P (p.u.)';
  const xMarker = plotUnits === 'physical' ? mw(p) : p;
  const xMax = plotUnits === 'physical' ? mw(pMax) : pMax;
  const qKey = plotUnits === 'physical' ? 'qMVAr' : 'qPu';
  const qLabel = plotUnits === 'physical' ? 'Line net Q (MVAr)' : 'Line net Q (p.u.)';
  const qTickDigits = plotUnits === 'physical' ? 0 : 3;
  const qYMin = plotUnits === 'physical' ? qMinMVAr : qMinPu;
  const qYMax = plotUnits === 'physical' ? qMaxMVAr : qMaxPu;

  const qStatus = !res.converged ? 'non-converged operating point' : Math.abs(res.qLine) < 5e-4 ? 'approximately reactive-neutral' : res.qLine > 0 ? 'net reactive absorption' : 'net reactive injection';
  const vStatus = !res.drawable ? 'voltage not solved' : res.vr > 1.005 ? 'receiving-end voltage rise' : res.vr < 0.995 ? 'receiving-end voltage drop' : 'near-flat voltage profile';

  return <div className="page"><style>{CSS}</style><div className="wrap">
    <header><h1>Per-unit transmission-line reactive power applet</h1><div className="badges"><span>{qStatus}</span><span>{vStatus}</span></div><p>Balanced three-phase nominal-π model in per unit. Positive line reactive power means net absorption by the isolated line; negative line reactive power means net capacitive injection.</p></header>
    <div className="layout"><aside className="card controls"><div className="titleRow"><h2>Inputs</h2><button className="secondary" onClick={resetDefaults}>Reset defaults</button></div>
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
        {(tab === 'q' || tab === 'v') && <div className="plotOptions"><button className="secondary" onClick={() => setPlotUnits(plotUnits === 'physical' ? 'pu' : 'physical')}>Plot axes: {plotUnits === 'physical' ? 'MW/MVAr' : 'p.u.'}</button><label className="check"><input type="checkbox" checked={fixedAxes} onChange={(e) => setFixedAxes(e.target.checked)} /> Fix y-axis</label>{fixedAxes && tab === 'q' && plotUnits === 'physical' && <><SmallNumber label="Q min" value={qMinMVAr} setValue={setQMinMVAr} unit="MVAr" /><SmallNumber label="Q max" value={qMaxMVAr} setValue={setQMaxMVAr} unit="MVAr" /></>}{fixedAxes && tab === 'q' && plotUnits !== 'physical' && <><SmallNumber label="Q min" value={qMinPu} setValue={setQMinPu} unit="p.u." step={0.1} /><SmallNumber label="Q max" value={qMaxPu} setValue={setQMaxPu} unit="p.u." step={0.1} /></>}{fixedAxes && tab === 'v' && <><SmallNumber label="V min" value={vMinPu} setValue={setVMinPu} unit="p.u." step={0.01} /><SmallNumber label="V max" value={vMaxPu} setValue={setVMaxPu} unit="p.u." step={0.01} /></>}</div>}
        {tab === 'q' && <><Chart data={sweep} xKey={xKey} yKey={qKey} xLabel={xLabel} yLabel={qLabel} title="Load sweep: line reactive absorption/injection" xMarker={xMarker} xMax={xMax} yZero={0} yTickDigits={qTickDigits} fixedY={fixedAxes} yMinFixed={qYMin} yMaxFixed={qYMax} /><p className="small">The zero line marks the transition between net reactive absorption and net capacitive injection. Grey regions indicate non-converged operating points; plotted values there are last finite iterative estimates and should be interpreted qualitatively.</p></>}
        {tab === 'v' && <><Chart data={sweep} xKey={xKey} yKey="vr" xLabel={xLabel} yLabel="Receiving-end voltage V_R (p.u.)" title="Load sweep: receiving-end voltage" xMarker={xMarker} xMax={xMax} yZero={1} yTickDigits={3} fixedY={fixedAxes} yMinFixed={vMinPu} yMaxFixed={vMaxPu} /><p className="small">Light-load voltage rise corresponds to the Ferranti-effect region. Grey regions indicate numerical instability or non-convergence.</p></>}
        {tab === 'notes' && <div className="small"><strong>Assumptions</strong><ul><li>Balanced three-phase steady-state phasor model.</li><li>Nominal-π equivalent: total series impedance Z = R + jX and total shunt admittance jB split equally at both ends.</li><li>The receiving-end load is a constant complex-power load.</li><li>For very long lines, a distributed-parameter model is more accurate than the nominal-π approximation.</li></ul></div>}
      </section></main></div></div></div>;
}

const CSS = `
*{box-sizing:border-box} body{margin:0}.page{min-height:100vh;background:#f6f7fb;color:#111827;padding:24px;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:1240px;margin:0 auto;display:flex;flex-direction:column;gap:18px}h1{font-size:clamp(26px,4vw,42px);line-height:1.05;margin:0;letter-spacing:-.035em}h2{font-size:18px;margin:0}p{margin:0;color:#4b5563;line-height:1.55}.badges{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.badges span{border:1px solid #d1d5db;background:white;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700}.layout{display:grid;grid-template-columns:360px minmax(0,1fr);gap:18px}.card{background:white;border:1px solid #e5e7eb;border-radius:22px;box-shadow:0 10px 28px rgba(15,23,42,.06);padding:18px;min-width:0}.controls,.main,.stack{display:flex;flex-direction:column;gap:16px}.titleRow{display:flex;align-items:center;justify-content:space-between;gap:8px}.control{display:flex;flex-direction:column;gap:8px}.controlTop{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}label{font-size:13px;font-weight:750}.hint,.small{color:#6b7280;font-size:13px;line-height:1.5}.num{display:flex;align-items:center;gap:6px}.num input{width:92px;height:32px;border:1px solid #d1d5db;border-radius:10px;padding:4px 8px;text-align:right}.num span{width:48px;color:#6b7280;font-size:12px}input[type=range]{width:100%}select{width:100%;height:38px;border:1px solid #d1d5db;border-radius:12px;padding:0 10px;background:white;font-weight:650}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.metric{border:1px solid #e5e7eb;background:#fbfdff;border-radius:18px;padding:12px;min-height:76px;min-width:0}.metricLabel{color:#6b7280;font-size:12px;margin-bottom:8px}.metricValue{font-size:20px;font-weight:800;overflow-wrap:anywhere}.metricValue span{color:#6b7280;font-size:12px;font-weight:600}.tabs,.plotOptions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}.tabs button,.tools button,.secondary{border:1px solid #d1d5db;background:#f9fafb;border-radius:999px;padding:8px 12px;font-size:13px;font-weight:750;cursor:pointer}.tabs button.active{background:#111827;color:white;border-color:#111827}.secondary:hover,.tools button:hover{background:#eef2ff}.check{display:flex;align-items:center;gap:6px;border:1px solid #d1d5db;background:#fff;border-radius:999px;padding:8px 12px}.smallInput{display:flex;align-items:center;gap:6px;border:1px solid #e5e7eb;background:#fff;border-radius:999px;padding:6px 10px}.smallInput input{width:82px;border:1px solid #d1d5db;border-radius:8px;padding:3px 6px;text-align:right}.smallInput span{color:#6b7280;font-size:12px}.identity{border:1px solid #e5e7eb;background:#fbfdff;border-radius:18px;padding:16px;line-height:1.6}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:13px;background:#f3f4f6;border-radius:12px;padding:10px;margin-top:10px;overflow-x:auto}.chart{width:100%;max-width:100%;min-width:0;overflow:hidden}.chartHeader{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px}.tools{display:flex;gap:6px;flex-wrap:wrap}.range{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;color:#4b5563;font-size:12px;font-weight:700}.range input{width:92px;margin-left:6px;border:1px solid #d1d5db;border-radius:9px;padding:4px 7px;text-align:right}svg{display:block;width:100%;height:auto;max-width:100%}.plotBg{fill:#fbfdff;stroke:#e5e7eb}.badBand{fill:#9ca3af;opacity:.22}.gridLine{stroke:#e5e7eb;stroke-width:1}.axis{stroke:#111827;stroke-width:1.2}.curve{fill:none;stroke:#111827;stroke-width:2.6}.marker{stroke:#ef4444;stroke-width:1.4;stroke-dasharray:6 5}.tick{font-size:11px;fill:#6b7280}.axisLabel{font-size:12px;font-weight:700;fill:#374151}ul{margin:8px 0 0;padding-left:20px}li{margin-bottom:6px}@media(max-width:980px){.layout{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.page{padding:14px}.metrics{grid-template-columns:1fr}.controlTop,.titleRow{flex-direction:column;align-items:stretch}}
`;
