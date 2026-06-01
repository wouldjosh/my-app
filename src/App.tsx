import { useState, useRef, useEffect } from "react";
import * as THREE from 'three';

const COLORS = ["#2563eb","#7c3aed","#059669","#d97706","#dc2626","#0891b2","#be185d","#0f766e","#b45309","#6d28d9","#0369a1","#15803d","#9f1239","#1d4ed8","#92400e"];
const MODEL  = "claude-sonnet-4-20250514";
const EMPTY  = { mark:"", length:"", width:"", depth:"", hasTop:false, hasBottom:false, hasEnds:false, connectors:[] };
const TL=48, TW=8.5, DUNN=0.25;
const h2i = h => parseInt(h.replace('#',''), 16);

function makeLabelTexture(mark) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(8, 8, 496, 112, 14);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 54px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(mark, 256, 64);
  return new THREE.CanvasTexture(canvas);
}

function Viewer3D({ pieces, plan, containerRef }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!plan?.stacks?.length || !pieces.length) return;
    const el = ref.current;
    if (!el) return;

    const W = el.clientWidth || 860, H = 480;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xc8d8e8);
    scene.fog = new THREE.Fog(0xc8d8e8, 100, 180);

    const camera = new THREE.PerspectiveCamera(48, W/H, 0.1, 300);
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
    catch { return; }
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(24, 40, 18); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-18, 10, -12); scene.add(fill);

    // Flatbed deck
    const deckMat = new THREE.MeshLambertMaterial({ color: 0x8b6914 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(TL, 0.25, TW), deckMat);
    deck.position.set(TL/2, -0.125, 0);
    scene.add(deck);

    // Steel side rails
    const steelMat = new THREE.MeshLambertMaterial({ color: 0x4a5568 });
    [[-TW/2 + 0.1], [TW/2 - 0.1]].forEach(([z]) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(TL, 0.18, 0.18), steelMat);
      rail.position.set(TL/2, -0.09, z); scene.add(rail);
    });
    // Cross beams every 4ft
    for (let x = 0; x <= TL; x += 4) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, TW), steelMat);
      beam.position.set(x, -0.075, 0); scene.add(beam);
    }
    // Stake pockets
    for (let x = 4; x < TL; x += 8) {
      [[-TW/2], [TW/2]].forEach(([z]) => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.1), steelMat);
        post.position.set(x, 0.3, z); scene.add(post);
      });
    }
    // Front headboard
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.8, TW), steelMat);
    hb.position.set(0, 0.9, 0); scene.add(hb);

    // Ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshLambertMaterial({ color: 0x9aab88 })
    );
    ground.rotation.x = -Math.PI/2; ground.position.y = -0.28; scene.add(ground);
    const grid = new THREE.GridHelper(160, 32, 0x6b7280, 0x9ca3af);
    grid.position.set(TL/2, -0.26, 0); scene.add(grid);

    // Stack layout
    const getAcross = stack => {
      let max = 0;
      stack.layers.forEach(layer => {
        const p = pieces.find(x => x.mark === layer.mark);
        if (p) max = Math.max(max, (parseFloat(p.depth) || 12) / 12);
      });
      return max || 1;
    };
    const GAP = 0.12;
    const totalZ = plan.stacks.reduce((s, st) => s + getAcross(st) + GAP, 0);
    let zCursor = -totalZ / 2;
    const stackZ = plan.stacks.map(st => {
      const across = getAcross(st);
      const z = zCursor + across / 2;
      zCursor += across + GAP;
      return z;
    });

    plan.stacks.forEach((stack, si) => {
      let y = 0;
      const z = stackZ[si];
      const col = h2i(COLORS[si % COLORS.length]);

      stack.layers.forEach((layer, li) => {
        const p = pieces.find(x => x.mark === layer.mark);
        if (!p) return;
        const pL      = parseFloat(p.length) || 20;
        const pStackH = (parseFloat(p.width)  || 7.875) / 12;
        const pAcross = (parseFloat(p.depth)  || 12)    / 12;
        const prev = li > 0 ? stack.layers[li-1] : null;

        // Dunnage: 3 individual blocks
        if (layer.dunnageBelow || prev?.dunnageAbove) {
          const dunnW = 0.33;
          const dunnD = Math.max(pAcross + 0.08, 0.5);
          const dunnMat = new THREE.MeshLambertMaterial({ color: 0xfbbf24 });
          const offset = pL >= 12 ? Math.min(5, pL * 0.2) : pL * 0.15;
          const positions = pL >= 12
            ? [offset, pL / 2, pL - offset]
            : [pL * 0.15, pL * 0.5, pL * 0.85];
          positions.forEach(dx => {
            const dm = new THREE.Mesh(new THREE.BoxGeometry(dunnW, DUNN, dunnD), dunnMat);
            dm.position.set(dx, y + DUNN/2, z); scene.add(dm);
            const de = new THREE.LineSegments(
              new THREE.EdgesGeometry(new THREE.BoxGeometry(dunnW, DUNN, dunnD)),
              new THREE.LineBasicMaterial({ color: 0xd97706, opacity: 0.6, transparent: true })
            );
            de.position.copy(dm.position); scene.add(de);
          });
          y += DUNN;
        }

        // Per-face materials: silver for metal faces
        const woodCol = new THREE.Color(col).lerp(new THREE.Color(0xffffff), 0.15);
        const metalCol = new THREE.Color(0x94a3b8);
        const mats = [
          new THREE.MeshLambertMaterial({ color: p.hasEnds   ? metalCol : woodCol }),
          new THREE.MeshLambertMaterial({ color: p.hasEnds   ? metalCol : woodCol }),
          new THREE.MeshLambertMaterial({ color: p.hasTop    ? metalCol : woodCol }),
          new THREE.MeshLambertMaterial({ color: p.hasBottom ? metalCol : woodCol }),
          new THREE.MeshLambertMaterial({ color: woodCol }),
          new THREE.MeshLambertMaterial({ color: woodCol }),
        ];
        const geo = new THREE.BoxGeometry(pL, pStackH, pAcross);
        const mesh = new THREE.Mesh(geo, mats);
        mesh.position.set(pL/2, y + pStackH/2, z); scene.add(mesh);
        const elines = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2 })
        );
        elines.position.copy(mesh.position); scene.add(elines);

        // Metal hardware
        if (p.hasTop || p.hasBottom || p.hasEnds) {
          const plateMat = new THREE.MeshLambertMaterial({ color: 0x718096 });
          const boltMat  = new THREE.MeshLambertMaterial({ color: 0x4a5568 });
          if (p.hasEnds) {
            [-pL/2, pL/2].forEach(ex => {
              const plate = new THREE.Mesh(new THREE.BoxGeometry(0.04, pStackH*0.85, pAcross*0.85), plateMat);
              plate.position.set(mesh.position.x + ex, mesh.position.y, z); scene.add(plate);
              [-pStackH*0.25, pStackH*0.25].forEach(by => {
                [-pAcross*0.25, pAcross*0.25].forEach(bz => {
                  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 6), boltMat);
                  bolt.rotation.z = Math.PI/2;
                  bolt.position.set(mesh.position.x + ex, mesh.position.y + by, z + bz); scene.add(bolt);
                });
              });
            });
          }
          if (p.hasTop) {
            const plate = new THREE.Mesh(new THREE.BoxGeometry(pL*0.7, 0.04, pAcross*0.7), plateMat);
            plate.position.set(mesh.position.x, mesh.position.y + pStackH/2, z); scene.add(plate);
          }
          if (p.hasBottom) {
            const plate = new THREE.Mesh(new THREE.BoxGeometry(pL*0.7, 0.04, pAcross*0.7), plateMat);
            plate.position.set(mesh.position.x, mesh.position.y - pStackH/2, z); scene.add(plate);
          }
        }

        // Part number label on top
        const labelTex = makeLabelTexture(layer.mark);
        const labelGeo = new THREE.PlaneGeometry(Math.min(pL*0.7, 6), Math.min(pStackH*0.6, 1.2));
        const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false });
        const label = new THREE.Mesh(labelGeo, labelMat);
        label.rotation.x = -Math.PI/2;
        label.position.set(pL/2, y + pStackH + 0.01, z); scene.add(label);

        y += pStackH;
      });
    });

    let theta=-0.28, phi=1.05, radius=64;
    const target = new THREE.Vector3(TL/2, 3.5, 0);
    const setCam = () => {
      camera.position.set(
        target.x + radius*Math.sin(phi)*Math.sin(theta),
        target.y + radius*Math.cos(phi),
        target.z + radius*Math.sin(phi)*Math.cos(theta)
      );
      camera.lookAt(target);
    };
    setCam();

    el._view = name => {
      const P = { persp:[-0.28,1.05,64], front:[Math.PI,Math.PI/2,32], side:[Math.PI/2,Math.PI/2.1,72], top:[0,0.07,62] };
      [theta, phi, radius] = P[name] || P.persp;
      setCam(); renderer.render(scene, camera);
    };
    el._snap = () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); };

    // Expose to parent ref
    if (containerRef) containerRef.current = { view: el._view, snap: el._snap };

    let drag=false, px=0, py=0;
    const onDown = e => { drag=true; px=e.clientX; py=e.clientY; };
    const onUp   = ()  => { drag=false; };
    const onMove = e => {
      if (!drag) return;
      theta += (e.clientX-px)*0.009;
      phi = Math.max(0.1, Math.min(Math.PI-0.1, phi+(e.clientY-py)*0.009));
      px=e.clientX; py=e.clientY; setCam();
    };
    const onWheel = e => { radius=Math.max(12,Math.min(140,radius+e.deltaY*0.05)); setCam(); e.preventDefault(); };
    renderer.domElement.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousemove', onMove);
    renderer.domElement.addEventListener('wheel', onWheel, { passive:false });
    const onResize = () => { const w=el.clientWidth; camera.aspect=w/H; camera.updateProjectionMatrix(); renderer.setSize(w,H); };
    window.addEventListener('resize', onResize);
    let raf;
    const animate = () => { raf=requestAnimationFrame(animate); renderer.render(scene,camera); };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('mousemove', onMove);
      renderer.domElement.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [pieces, plan]);

  return (
    <div>
      <div ref={ref} style={{ width:'100%', borderRadius:8, overflow:'hidden', cursor:'grab', userSelect:'none' }} />
      <div style={{ display:'flex', gap:8, marginTop:8, alignItems:'center', flexWrap:'wrap' }}>
        <span style={{ fontSize:12, color:'#64748b', fontWeight:600 }}>View:</span>
        {[['Perspective','persp'],['Front','front'],['Side','side'],['Top','top']].map(([lbl,k])=>(
          <button key={k} onClick={()=>ref.current?._view?.(k)}
            style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:6, padding:'4px 12px', fontSize:12, cursor:'pointer', color:'#475569' }}>
            {lbl}
          </button>
        ))}
        <span style={{ fontSize:11, color:'#94a3b8', marginLeft:'auto' }}>Drag to rotate · Scroll to zoom</span>
      </div>
    </div>
  );
}

function LoadoutChat({ pieces, plan, onNewPlan }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const chatRef = useRef(null);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role:'user', text: userMsg }]);
    setLoading(true);
    try {
      const history = messages.map(m => ({ role: m.role==='user'?'user':'assistant', content: m.text }));
      const sysCtx = `You are a rigging foreman assistant. Current load plan: ${JSON.stringify(plan)}. Pieces: ${JSON.stringify(pieces.map(p=>({mark:p.mark,length:+p.length,width:+p.width,depth:+p.depth,hasTop:p.hasTop,hasBottom:p.hasBottom,hasEnds:p.hasEnds})))}. Trailer: 48ft flatbed, 8.5ft wide.`;
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          model: MODEL, max_tokens: 2000, system: sysCtx,
          messages: [...history, { role:'user', content: userMsg + '\n\nIf suggesting a new arrangement, include JSON:\n```json\n{"stacks":[...],"notes":[...]}\n```' }]
        })
      });
      const d = await r.json();
      const txt = d.content?.filter(b=>b.type==='text').map(b=>b.text).join('') || 'No response.';
      const jsonMatch = txt.match(/```json\s*([\s\S]*?)\s*```/);
      let newPlan = null;
      if (jsonMatch) { try { newPlan = JSON.parse(jsonMatch[1]); } catch {} }
      setMessages(prev => [...prev, { role:'assistant', text: txt, newPlan }]);
    } catch(e) {
      setMessages(prev => [...prev, { role:'assistant', text: `Error: ${e.message}` }]);
    }
    setLoading(false);
  };

  return (
    <div style={{border:'1px solid #e2e8f0',borderRadius:10,overflow:'hidden',marginTop:16,background:'white'}}>
      <div style={{background:'#1e3a5f',color:'white',padding:'10px 16px',fontSize:13,fontWeight:600,display:'flex',alignItems:'center',gap:8}}>
        💬 Loadout Issue Assistant
        <span style={{marginLeft:'auto',fontSize:11,opacity:0.7,fontWeight:400}}>Describe a problem — AI will suggest a fix</span>
      </div>
      <div ref={chatRef} style={{height:200,overflowY:'auto',padding:14,display:'flex',flexDirection:'column',gap:10,background:'#f8fafc'}}>
        {messages.length===0 && (
          <div style={{color:'#94a3b8',fontSize:12,textAlign:'center',marginTop:60}}>
            Describe any loading issue — weight distribution, connector clearance, height limits, etc.
          </div>
        )}
        {messages.map((m,i)=>(
          <div key={i} style={{display:'flex',flexDirection:'column',alignItems:m.role==='user'?'flex-end':'flex-start',gap:4}}>
            <div style={{
              background:m.role==='user'?'#1e3a5f':'white',color:m.role==='user'?'white':'#1e293b',
              padding:'8px 12px',borderRadius:8,maxWidth:'85%',fontSize:12,lineHeight:1.5,
              border:m.role==='assistant'?'1px solid #e2e8f0':undefined,whiteSpace:'pre-wrap'
            }}>
              {m.text.replace(/```json[\s\S]*?```/g,'[New plan generated below ↓]')}
            </div>
            {m.newPlan && (
              <button onClick={()=>onNewPlan(m.newPlan)}
                style={{background:'#059669',color:'white',border:'none',borderRadius:6,padding:'6px 14px',fontSize:12,cursor:'pointer',fontWeight:600}}>
                ✅ Apply This New Plan
              </button>
            )}
          </div>
        ))}
        {loading && <div style={{color:'#64748b',fontSize:12,display:'flex',gap:6,alignItems:'center'}}><span>⏳</span> Analyzing loadout…</div>}
      </div>
      <div style={{display:'flex',gap:8,padding:10,borderTop:'1px solid #e2e8f0',background:'white'}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&send()}
          placeholder="e.g. The rear stacks are too heavy, can you rebalance the load…"
          style={{flex:1,border:'1px solid #d1d5db',borderRadius:6,padding:'7px 10px',fontSize:12,outline:'none'}}/>
        <button onClick={send} disabled={loading||!input.trim()}
          style={{background:'#1e3a5f',color:'white',border:'none',borderRadius:6,padding:'7px 14px',fontSize:12,cursor:'pointer',fontWeight:600,opacity:loading||!input.trim()?0.5:1}}>
          Send
        </button>
      </div>
    </div>
  );
}

async function generatePDF(pieces, plan, viewerCtrl) {
  if (!window.jspdf) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:'landscape', unit:'pt', format:'letter' });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();

  const addHeader = (title) => {
    doc.setFillColor(30,58,95); doc.rect(0,0,pw,36,'F');
    doc.setTextColor(255,255,255); doc.setFontSize(14); doc.setFont('helvetica','bold');
    doc.text('Glulam Load Plan', 18, 23);
    doc.setFontSize(10); doc.setFont('helvetica','normal');
    doc.text(title, pw/2, 23, {align:'center'});
    doc.text(new Date().toLocaleDateString(), pw-18, 23, {align:'right'});
    doc.setTextColor(0,0,0);
  };

  const viewPresets = [
    {name:'Perspective View', key:'persp'},
    {name:'Top View',         key:'top'},
    {name:'Front View',       key:'front'},
    {name:'Side View',        key:'side'},
  ];

  for (let vi=0; vi<viewPresets.length; vi++) {
    if (vi>0) doc.addPage();
    addHeader(`${viewPresets[vi].name} — ${pieces.length} pieces, ${plan.stacks?.length} stacks`);
    if (viewerCtrl?.view && viewerCtrl?.snap) {
      viewerCtrl.view(viewPresets[vi].key);
      await new Promise(r => setTimeout(r, 120));
      const imgData = viewerCtrl.snap();
      doc.addImage(imgData, 'PNG', 18, 46, pw-36, ph-60);
    }
    doc.setFontSize(9); doc.setTextColor(100,100,100);
    doc.text(`${viewPresets[vi].name} · Front (cab) = LEFT · Rear = RIGHT`, 18, ph-10);
  }

  // Part list page
  doc.addPage();
  addHeader(`Part List — Forklift Driver Copy · ${pieces.length} pieces total`);

  const allLayers = [];
  plan.stacks?.forEach((stack, si) => {
    stack.layers.forEach((layer, li) => {
      const p = pieces.find(x => x.mark === layer.mark);
      allLayers.push({
        stackId: stack.id, position: stack.position, order: li+1,
        mark: layer.mark,
        length: p ? `${(+p.length).toFixed(2)} ft` : '—',
        dims: p ? `${p.width}"×${p.depth}"` : '—',
        metal: [p?.hasTop?'Top':'', p?.hasBottom?'Bot':'', p?.hasEnds?'Ends':''].filter(Boolean).join(', ')||'—',
        dunnage: [layer.dunnageBelow?'Below':'', layer.dunnageAbove?'Above':''].filter(Boolean).join('/')||'—',
        note: layer.note||'',
        color: COLORS[si % COLORS.length],
      });
    });
  });

  const cols = [
    {label:'Stack',    w:46},
    {label:'Position', w:68},
    {label:'Layer',    w:42},
    {label:'Mark #',   w:82},
    {label:'Length',   w:64},
    {label:'W×D',      w:68},
    {label:'Metal',    w:64},
    {label:'Dunnage',  w:68},
    {label:'Notes',    w:160},
  ];
  let ty=52, tl=18;
  const rh=20, totalW=cols.reduce((s,c)=>s+c.w,0);

  doc.setFillColor(241,245,249); doc.rect(tl,ty,totalW,rh,'F');
  doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(50,50,80);
  let cx=tl+4;
  cols.forEach(c=>{doc.text(c.label,cx,ty+13);cx+=c.w;});
  ty+=rh;

  doc.setFont('helvetica','normal');
  allLayers.forEach((row,ri)=>{
    if(ty+rh>ph-30){doc.addPage();addHeader('Part List (continued)');ty=52;}
    doc.setFillColor(...(ri%2===0?[255,255,255]:[248,250,252]));
    doc.rect(tl,ty,totalW,rh,'F');
    const hx=row.color.replace('#','');
    doc.setFillColor(parseInt(hx.slice(0,2),16),parseInt(hx.slice(2,4),16),parseInt(hx.slice(4,6),16));
    doc.rect(tl+2,ty+5,10,10,'F');
    doc.setTextColor(30,30,30);
    cx=tl+16;
    [row.stackId,row.position,`#${row.order}`,row.mark,row.length,row.dims,row.metal,row.dunnage,row.note].forEach((v,ci)=>{
      const txt=String(v||'—'); doc.text(txt.length>22?txt.slice(0,21)+'…':txt, cx, ty+13); cx+=cols[ci].w;
    });
    ty+=rh;
  });

  if(plan.notes?.length){
    ty+=14;
    doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(30,58,95);
    doc.text('Loading Notes:',tl,ty); ty+=14;
    doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(50,50,80);
    plan.notes.forEach(n=>{doc.text(`• ${n}`,tl+8,ty);ty+=13;});
  }

  const pc=doc.internal.getNumberOfPages();
  for(let i=1;i<=pc;i++){
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(150,150,150);
    doc.text(`Page ${i} of ${pc} · Glulam Load Planner · wouldjosh.com`, pw/2, ph-6, {align:'center'});
  }
  doc.save('load-plan.pdf');
}

export default function App() {
  const [pieces,   setPieces]   = useState([]);
  const [plan,     setPlan]     = useState(null);
  const [stage,    setStage]    = useState("build");
  const [view3d,   setView3d]   = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanMsg,  setScanMsg]  = useState("");
  const [error,    setError]    = useState(null);
  const [debug,    setDebug]    = useState(null);
  const [showDbg,  setShowDbg]  = useState(false);
  const [form,     setForm]     = useState(EMPTY);
  const [dragOver, setDragOver] = useState(false);
  const [genPdf,   setGenPdf]   = useState(false);
  const fileRef    = useRef();
  const viewerCtrl = useRef(null);

  const compress = file => new Promise((res,rej) => {
    const r = new FileReader(); r.onerror=rej;
    r.onload = ev => {
      const img = new Image(); img.onerror=rej;
      img.onload = () => {
        const MAX=1500; let w=img.width,h=img.height;
        if(w>MAX||h>MAX){if(w>=h){h=Math.round(h*MAX/w);w=MAX;}else{w=Math.round(w*MAX/h);h=MAX;}}
        const c=document.createElement('canvas');c.width=w;c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        res({b64:c.toDataURL('image/jpeg',0.88).split(',')[1],mime:'image/jpeg'});
      };
      img.src=ev.target.result;
    };
    r.readAsDataURL(file);
  });

  const extractJSON = txt => {
    const s=txt.replace(/```[\w]*\n?/g,'').trim();
    for(let i=0;i<s.length;i++){
      if(s[i]!=='['&&s[i]!=='{')continue;
      const open=s[i],close=open==='['?']':'}';
      let depth=0,inStr=false,esc=false;
      for(let j=i;j<s.length;j++){
        const c=s[j];
        if(esc){esc=false;continue;}if(c==='\\'&&inStr){esc=true;continue;}
        if(c==='"'){inStr=!inStr;continue;}if(inStr)continue;
        if(c===open)depth++;if(c===close){depth--;if(depth===0){try{const p=JSON.parse(s.slice(i,j+1));return Array.isArray(p)?p:[p];}catch{break;}}}
      }
    }
    throw new Error('No valid JSON: '+s.slice(0,200));
  };

  const callAPI = async (messages, maxTok=1200) => {
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,max_tokens:maxTok,messages})});
    const d=await r.json();
    if(!r.ok)throw new Error(`API ${r.status}: ${d.error?.message||JSON.stringify(d).slice(0,200)}`);
    if(!d.content?.length)throw new Error('Empty API response');
    return d.content.filter(b=>b.type==='text').map(b=>b.text).join('');
  };

  const scanFile = async file => {
    const {b64,mime}=await compress(file);
    const txt=await callAPI([{role:'user',content:[
      {type:'image',source:{type:'base64',media_type:mime,data:b64}},
      {type:'text',text:`You are reading a Timberlab glulam single-piece shop drawing.\nDRAWING FORMAT:\n- Top-left: ASSEMBLY ID (e.g. B04238), PROPERTIES: Billet Width, Billet Depth\n- Overall length = largest callout on view 1 (TOP) or view 3 (FRONT)\n- Views: 2=TOP ASSEMBLY, 12=BOTTOM ASSEMBLY, 5=LEFT ASSEMBLY, 8=RIGHT ASSEMBLY, 4=FRONT ASSEMBLY, 10=BACK ASSEMBLY\nSHOP-INSTALLED connectors: SDCF part numbers, CNSK bolts, DRILL holes, GS-P2, MTWIG washers\nSKIP: "field installed" "FI" "NIC" "DNIOS" "by others" "field weld"\nConnector location by view: 2=top_face, 12=bottom_face, 5=left_end, 8=right_end, 4=front_face, 10=back_face\nReturn ONLY a JSON array starting with [ and ending with ]:\n[{"mark":"B04238","length":22.01,"width":7.875,"depth":31.5,"unit":"ft","connectors":[{"location":"right_end","type":"SDCF CNSK"}],"hasTop":false,"hasBottom":true,"hasEnds":true}]`}
    ]}]);
    return extractJSON(txt);
  };

  const handleFiles = async files => {
    setError(null);setDebug(null);
    const arr=Array.from(files);
    for(let i=0;i<arr.length;i++){
      setScanning(true);setScanMsg(`Scanning ${arr[i].name} (${i+1}/${arr.length})…`);
      try{
        const found=await scanFile(arr[i]);
        setPieces(prev=>{const marks=new Set(prev.map(p=>p.mark));return[...prev,...found.filter(p=>!marks.has(p.mark)).map((p,j)=>({...p,id:Date.now()+j}))];});
      }catch(e){setDebug(e.message);setShowDbg(true);setError(`Failed on ${arr[i].name}: ${e.message}`);}
    }
    setScanning(false);setScanMsg('');
  };

  const onDrop = e=>{e.preventDefault();setDragOver(false);handleFiles(e.dataTransfer.files);};
  const addManual = ()=>{
    if(!form.mark||!form.length)return;
    setPieces(prev=>[...prev,{...form,id:Date.now(),length:parseFloat(form.length),width:parseFloat(form.width)||0,depth:parseFloat(form.depth)||0,unit:'ft'}]);
    setForm(EMPTY);
  };
  const removePiece = id=>setPieces(prev=>prev.filter(p=>p.id!==id));
  const updatePiece = (id,f,v)=>setPieces(prev=>prev.map(p=>p.id===id?{...p,[f]:v}:p));

  const generatePlan = async ()=>{
    setStage('planning');setError(null);
    try{
      const txt=await callAPI([{role:'user',content:
`Rigging foreman loading ${pieces.length} glulam beams onto a 48ft flatbed trailer (open sides, 8.5ft wide).
Pieces: ${JSON.stringify(pieces.map(p=>({mark:p.mark,length:+p.length,width:+p.width,depth:+p.depth,hasTop:p.hasTop,hasBottom:p.hasBottom,hasEnds:p.hasEnds})))}
RULES:
1. Longer pieces → FRONT. Shorter → REAR.
2. Larger cross-section (width×depth) → BOTTOM of stack.
3. hasTop=true → dunnageAbove:true. hasBottom=true → dunnageBelow:true.
4. hasEnds=true → note end clearance. Group 2–5 similar-length pieces per stack.
5. layers[0]=bottom, last=top. Distribute stacks across trailer width.
6. Dunnage = 3 blocks/piece: one 5ft from front end, one centered, one 5ft from rear end.
Return ONLY JSON starting { ending }:
{"stacks":[{"id":1,"position":"front","layers":[{"mark":"B04228","dunnageBelow":false,"dunnageAbove":false,"note":"end hardware clearance"}]}],"notes":["crew note"]}`
      }],3000);
      setDebug(txt);
      const parsed=extractJSON(txt);
      setPlan(Array.isArray(parsed)?parsed[0]:parsed);
      setView3d(true);setStage('plan');
    }catch(e){setDebug(e.message);setShowDbg(true);setError(e.message);setStage('build');}
  };

  const handleDownloadPDF = async ()=>{
    setGenPdf(true);
    try{ await generatePDF(pieces, plan, viewerCtrl.current); }
    catch(e){ setError('PDF error: '+e.message); }
    setGenPdf(false);
  };

  const Btn=({label,onClick,bg='#1e3a5f',fg='white',bd='none',disabled=false})=>(
    <button onClick={onClick} disabled={disabled}
      style={{background:bg,color:fg,border:bd,padding:'8px 16px',borderRadius:8,fontSize:13,cursor:disabled?'not-allowed':'pointer',fontWeight:500,opacity:disabled?.5:1,whiteSpace:'nowrap'}}>
      {label}
    </button>
  );

  return (
    <div style={{fontFamily:'system-ui,sans-serif',maxWidth:1040,margin:'0 auto',padding:20,background:'#f8fafc',minHeight:'100vh'}}>

      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:18,flexWrap:'wrap'}}>
        <div style={{background:'#1e3a5f',color:'white',padding:'8px 18px',borderRadius:8,fontWeight:700,fontSize:16}}>🚛 Glulam Load Planner</div>
        {stage==='plan'&&<Btn label='← Edit Pieces' onClick={()=>{setStage('build');setPlan(null);}} bg='white' fg='#475569' bd='1px solid #cbd5e1'/>}
        {pieces.length>0&&stage!=='plan'&&<Btn label='🗑 Clear All' onClick={()=>setPieces([])} bg='white' fg='#ef4444' bd='1px solid #fca5a5'/>}
        <div style={{marginLeft:'auto',background:'#e2e8f0',borderRadius:20,padding:'4px 14px',fontSize:13,color:'#475569',fontWeight:600}}>
          {pieces.length} piece{pieces.length!==1?'s':''} loaded
        </div>
      </div>

      {error&&<div style={{background:'#fee2e2',border:'1px solid #fca5a5',padding:12,borderRadius:8,marginBottom:14,fontSize:13,color:'#991b1b'}}>
        <strong>Error:</strong> {error}
        {debug&&<button onClick={()=>setShowDbg(v=>!v)} style={{marginLeft:10,background:'#fca5a5',border:'none',borderRadius:4,padding:'2px 8px',cursor:'pointer',fontSize:12}}>{showDbg?'Hide':'Show'} details</button>}
      </div>}
      {showDbg&&debug&&<pre style={{background:'#1e293b',color:'#e2e8f0',padding:14,borderRadius:8,fontSize:11,overflowX:'auto',marginBottom:14,whiteSpace:'pre-wrap',wordBreak:'break-all'}}>{debug}</pre>}

      {(stage==='build'||stage==='planning')&&<>
        <div onDragOver={e=>{e.preventDefault();setDragOver(true)}} onDragLeave={()=>setDragOver(false)} onDrop={onDrop}
          onClick={()=>!scanning&&fileRef.current.click()}
          style={{background:dragOver?'#eff6ff':'white',border:`2px dashed ${dragOver?'#3b82f6':'#cbd5e1'}`,borderRadius:12,padding:26,textAlign:'center',cursor:scanning?'default':'pointer',marginBottom:16,transition:'all .15s'}}>
          <input ref={fileRef} type='file' accept='image/*' multiple onChange={e=>handleFiles(e.target.files)} style={{display:'none'}}/>
          {scanning
            ?<div><div style={{fontSize:26,marginBottom:6}}>🔍</div><p style={{color:'#475569',fontWeight:500,margin:0}}>{scanMsg}</p><p style={{color:'#94a3b8',fontSize:12,margin:'4px 0 0'}}>Identifying pieces and connectors…</p></div>
            :<div><div style={{fontSize:30,marginBottom:6}}>📐</div><p style={{color:'#1e293b',fontWeight:600,margin:'0 0 3px'}}>Drop blueprints here or click to browse</p><p style={{color:'#94a3b8',fontSize:12,margin:0}}>Upload Timberlab shop drawings — each sheet adds to the list below</p></div>
          }
        </div>

        {pieces.length>0&&<div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',marginBottom:16,overflow:'hidden'}}>
          <div style={{padding:'12px 18px',borderBottom:'1px solid #f1f5f9',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
            <span style={{fontWeight:700,color:'#1e293b',fontSize:14}}>Piece List — {pieces.length} pieces</span>
            <Btn label='Generate Load Plan →' onClick={generatePlan} disabled={scanning||stage==='planning'||pieces.length<2}/>
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead><tr style={{background:'#f8fafc'}}>
                {['#','Mark','Length ft','Width in','Depth in','Top ⚠','Bot ⚠','End ⚠','Connectors',''].map(h=>(
                  <th key={h} style={{padding:'7px 10px',textAlign:'left',color:'#64748b',fontWeight:600,borderBottom:'1px solid #e2e8f0',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {pieces.map((p,i)=>(
                  <tr key={p.id} style={{borderBottom:'1px solid #f8fafc',background:i%2?'#fafafa':'white'}}>
                    <td style={{padding:'6px 10px',color:'#94a3b8',fontSize:11}}>{i+1}</td>
                    <td style={{padding:'6px 10px'}}><input value={p.mark} onChange={e=>updatePiece(p.id,'mark',e.target.value)} style={{border:'1px solid #e2e8f0',borderRadius:4,padding:'3px 5px',width:72,fontSize:12,fontWeight:700,color:'#1e3a5f'}}/></td>
                    <td style={{padding:'6px 10px'}}><input type='number' value={p.length} onChange={e=>updatePiece(p.id,'length',e.target.value)} style={{border:'1px solid #e2e8f0',borderRadius:4,padding:'3px 5px',width:54,fontSize:12}}/></td>
                    <td style={{padding:'6px 10px'}}><input type='number' value={p.width} onChange={e=>updatePiece(p.id,'width',e.target.value)} style={{border:'1px solid #e2e8f0',borderRadius:4,padding:'3px 5px',width:50,fontSize:12}}/></td>
                    <td style={{padding:'6px 10px'}}><input type='number' value={p.depth} onChange={e=>updatePiece(p.id,'depth',e.target.value)} style={{border:'1px solid #e2e8f0',borderRadius:4,padding:'3px 5px',width:50,fontSize:12}}/></td>
                    {['hasTop','hasBottom','hasEnds'].map(f=>(
                      <td key={f} style={{padding:'6px 10px',textAlign:'center'}}><input type='checkbox' checked={!!p[f]} onChange={e=>updatePiece(p.id,f,e.target.checked)} style={{width:14,height:14,cursor:'pointer'}}/></td>
                    ))}
                    <td style={{padding:'6px 10px',color:'#94a3b8',maxWidth:130,fontSize:11,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.connectors?.map(c=>`${c.location}: ${c.type}`).join(', ')||'—'}</td>
                    <td style={{padding:'6px 10px'}}><span onClick={()=>removePiece(p.id)} style={{cursor:'pointer',color:'#ef4444',fontSize:16}}>×</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>}

        {stage==='planning'&&<div style={{background:'white',borderRadius:12,padding:28,border:'1px solid #e2e8f0',textAlign:'center',marginBottom:16}}>
          <div style={{fontSize:30,marginBottom:8}}>📋</div>
          <p style={{color:'#1e293b',fontWeight:600,margin:'0 0 4px'}}>Building Load Plan…</p>
          <p style={{color:'#64748b',fontSize:13,margin:0}}>Arranging {pieces.length} pieces for stability and connector safety</p>
        </div>}

        <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',padding:16}}>
          <p style={{fontSize:13,color:'#64748b',fontWeight:600,margin:'0 0 10px'}}>Add piece manually:</p>
          <div style={{display:'grid',gridTemplateColumns:'1fr 70px 70px 70px',gap:8,marginBottom:8}}>
            {[['mark','Mark (e.g. B04238)','text'],['length','Length ft','number'],['width','Width in','number'],['depth','Depth in','number']].map(([f,ph,t])=>(
              <input key={f} type={t} value={form[f]} onChange={e=>setForm(v=>({...v,[f]:e.target.value}))} placeholder={ph}
                style={{border:'1px solid #d1d5db',borderRadius:6,padding:'7px 10px',fontSize:13}}/>
            ))}
          </div>
          <div style={{display:'flex',gap:16,marginBottom:10,flexWrap:'wrap'}}>
            {[['hasTop','Top face metal'],['hasBottom','Bottom face metal'],['hasEnds','End metal']].map(([f,l])=>(
              <label key={f} style={{display:'flex',alignItems:'center',gap:6,fontSize:13,cursor:'pointer'}}>
                <input type='checkbox' checked={form[f]} onChange={e=>setForm(v=>({...v,[f]:e.target.checked}))} style={{width:15,height:15}}/>{l}
              </label>
            ))}
          </div>
          <Btn label='+ Add Piece' onClick={addManual} bg='#f1f5f9' fg='#334155' bd='1px solid #e2e8f0'/>
        </div>
      </>}

      {stage==='plan'&&plan&&<div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 18px',borderBottom:'1px solid #f1f5f9',flexWrap:'wrap',gap:8}}>
          <div style={{display:'flex',background:'#f1f5f9',borderRadius:8,padding:3,gap:0}}>
            {[['3D View',true],['Plan View',false]].map(([lbl,is3d])=>(
              <button key={lbl} onClick={()=>setView3d(is3d)}
                style={{padding:'6px 18px',fontSize:13,border:'none',borderRadius:6,cursor:'pointer',fontWeight:500,background:view3d===is3d?'white':'transparent',color:view3d===is3d?'#1e3a5f':'#64748b',boxShadow:view3d===is3d?'0 1px 3px rgba(0,0,0,.1)':undefined}}>
                {lbl}
              </button>
            ))}
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <Btn label='🔄 Regenerate' onClick={generatePlan} bg='white' fg='#475569' bd='1px solid #cbd5e1'/>
            <Btn label={genPdf?'⏳ Generating PDF…':'📄 Download PDF'} onClick={handleDownloadPDF} disabled={genPdf} bg='#059669'/>
          </div>
        </div>

        <div style={{padding:18}}>
          {view3d&&<Viewer3D pieces={pieces} plan={plan} containerRef={viewerCtrl}/>}

          {!view3d&&<>
            <p style={{color:'#64748b',margin:'0 0 12px',fontSize:13}}>{pieces.length} pieces · {plan.stacks?.length} stacks · Front (cab) left → Rear right</p>
            <div style={{background:'#f1f5f9',border:'2px solid #94a3b8',borderRadius:8,padding:'12px 16px',overflowX:'auto',marginBottom:14}}>
              <div style={{display:'flex',gap:10,alignItems:'flex-end',minWidth:'fit-content'}}>
                <div style={{textAlign:'center',paddingBottom:6}}><div style={{fontSize:22}}>🚛</div><div style={{fontSize:9,color:'#94a3b8',fontWeight:700}}>FRONT</div></div>
                {plan.stacks?.map((stack,si)=>{
                  const col=COLORS[si%COLORS.length];
                  return <div key={si} style={{minWidth:82}}>
                    {[...stack.layers].reverse().map((layer,li)=>{
                      const origIdx=stack.layers.length-1-li;
                      const next=stack.layers[origIdx+1];
                      const showDT=layer.dunnageAbove||next?.dunnageBelow;
                      return <div key={li}>
                        {showDT&&<div style={{background:'#fbbf24',height:7,borderRadius:3,marginBottom:2,border:'1px dashed #d97706',display:'flex',alignItems:'center',justifyContent:'center'}}><span style={{fontSize:7,color:'#78350f',fontWeight:700}}>DUNNAGE</span></div>}
                        <div style={{background:col,color:'white',padding:'5px 7px',borderRadius:4,marginBottom:2,textAlign:'center'}}>
                          <div style={{fontWeight:700,fontSize:11}}>{layer.mark}</div>
                          {layer.note&&<div style={{fontSize:8,opacity:.8,marginTop:1,lineHeight:1.2}}>{layer.note}</div>}
                        </div>
                        {origIdx===0&&layer.dunnageBelow&&<div style={{background:'#fbbf24',height:7,borderRadius:3,marginBottom:2,border:'1px dashed #d97706',display:'flex',alignItems:'center',justifyContent:'center'}}><span style={{fontSize:7,color:'#78350f',fontWeight:700}}>DUNNAGE</span></div>}
                      </div>;
                    })}
                    <div style={{background:'#475569',height:6,borderRadius:3}}/>
                    <div style={{textAlign:'center',marginTop:4,fontSize:10,color:'#64748b',fontWeight:600}}>S{stack.id}</div>
                    <div style={{textAlign:'center',fontSize:9,color:'#94a3b8'}}>{stack.position}</div>
                  </div>;
                })}
                <div style={{textAlign:'center',paddingBottom:6}}><div style={{fontSize:14,color:'#94a3b8'}}>▶</div><div style={{fontSize:9,color:'#94a3b8',fontWeight:700}}>REAR</div></div>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(175px,1fr))',gap:10,marginBottom:14}}>
              {plan.stacks?.map((stack,si)=>(
                <div key={si} style={{border:`2px solid ${COLORS[si%COLORS.length]}33`,borderRadius:8,padding:10}}>
                  <div style={{fontWeight:700,color:'#1e293b',marginBottom:7,fontSize:12,display:'flex',alignItems:'center',gap:5}}>
                    <div style={{width:8,height:8,borderRadius:'50%',background:COLORS[si%COLORS.length],flexShrink:0}}/>Stack {stack.id} — {stack.position}
                  </div>
                  {[...stack.layers].reverse().map((layer,li)=>(
                    <div key={li} style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:4,marginBottom:4}}>
                      <span style={{background:COLORS[si%COLORS.length],color:'white',padding:'2px 7px',borderRadius:20,fontSize:11,fontWeight:700}}>{layer.mark}</span>
                      {layer.dunnageAbove&&<span style={{background:'#fef3c7',color:'#92400e',padding:'2px 5px',borderRadius:20,fontSize:10}}>dunnage↑</span>}
                      {layer.dunnageBelow&&<span style={{background:'#fef3c7',color:'#92400e',padding:'2px 5px',borderRadius:20,fontSize:10}}>dunnage↓</span>}
                      {layer.note&&<span style={{fontSize:10,color:'#64748b',width:'100%'}}>↳ {layer.note}</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>}

          {plan.notes?.length>0&&<div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8,padding:12,marginTop:view3d?14:0}}>
            <div style={{fontWeight:600,color:'#1e40af',marginBottom:6,fontSize:13}}>📌 Loading Notes</div>
            {plan.notes.map((n,i)=><div key={i} style={{fontSize:13,color:'#1e40af',marginBottom:3}}>• {n}</div>)}
          </div>}

          {view3d&&<div style={{display:'flex',flexWrap:'wrap',gap:7,marginTop:12}}>
            {plan.stacks?.map((stack,si)=>(
              <div key={si} style={{display:'flex',alignItems:'center',gap:5,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:20,padding:'3px 10px'}}>
                <div style={{width:9,height:9,borderRadius:'50%',background:COLORS[si%COLORS.length],flexShrink:0}}/>
                <span style={{fontSize:11,color:'#475569',fontWeight:500}}>S{stack.id}: {stack.layers.map(l=>l.mark).join(', ')}</span>
              </div>
            ))}
            <div style={{display:'flex',alignItems:'center',gap:5,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:20,padding:'3px 10px'}}>
              <div style={{width:22,height:7,background:'#fbbf24',borderRadius:3,border:'1px solid #d97706'}}/>
              <span style={{fontSize:11,color:'#475569'}}>Dunnage (3 blocks/piece)</span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:5,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:20,padding:'3px 10px'}}>
              <div style={{width:14,height:9,background:'#94a3b8',borderRadius:2}}/>
              <span style={{fontSize:11,color:'#475569'}}>Metal hardware</span>
            </div>
          </div>}

          <LoadoutChat
            pieces={pieces}
            plan={plan}
            onNewPlan={newPlan=>{setPlan(newPlan);setView3d(true);}}
          />
        </div>
      </div>}
    </div>
  );
}
