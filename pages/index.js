import { useState, useRef, useCallback, useEffect } from "react";
import Head from "next/head";

const SECTIONS = [
  { title: "당사자 정보", fields: [
    { key: "shipper", label: "Shipper" },
    { key: "consignee", label: "Consignee" },
    { key: "notify_party", label: "Notify Party" },
  ]},
  { title: "운항 정보", fields: [
    { key: "carrier", label: "Carrier / 선사" },
    { key: "vessel", label: "Vessel / Voyage" },
    { key: "port_of_loading", label: "Port of Loading (POL)" },
    { key: "port_of_discharge", label: "Port of Discharge (POD)" },
    { key: "etd", label: "ETD" },
    { key: "eta", label: "ETA" },
  ]},
  { title: "부킹 / 컨테이너", fields: [
    { key: "booking_no", label: "Booking No." },
    { key: "container_type", label: "Container Type / Size" },
    { key: "container_no", label: "Container No." },
    { key: "seal_no", label: "Seal No." },
    { key: "cy_code", label: "장치장 / CY 코드" },
    { key: "doc_cutoff", label: "서류 마감 (Doc Cut-off)" },
    { key: "cargo_cutoff", label: "반입 마감 (Cargo Cut-off)" },
    { key: "free_time", label: "Free Time" },
  ]},
  { title: "화물 정보", fields: [
    { key: "hs_code", label: "HS Code" },
    { key: "description", label: "Description of Goods" },
    { key: "commodity", label: "Commodity" },
    { key: "gross_weight", label: "Gross Weight" },
    { key: "measurement", label: "Measurement (CBM)" },
    { key: "package_count", label: "Package Count / Type" },
  ]},
  { title: "인보이스 / 조건", fields: [
    { key: "invoice_no", label: "Invoice No." },
    { key: "invoice_value", label: "Invoice Value" },
    { key: "incoterms", label: "Incoterms" },
    { key: "freight_terms", label: "Freight Terms" },
    { key: "shipper_ref", label: "Shipper's Ref / PO No." },
    { key: "bl_no", label: "B/L No." },
  ]},
];

const ALLOWED = ["application/pdf","image/jpeg","image/png","image/webp","image/gif",
  "text/plain","text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-excel"];
const FICONS = {
  "application/pdf":"📄","image/jpeg":"🖼️","image/png":"🖼️","image/webp":"🖼️",
  "text/plain":"📝","text/csv":"📝",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"📊","application/vnd.ms-excel":"📊"
};

async function toBase64(f) {
  return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(f);});
}
async function readText(f) {
  return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsText(f,"utf-8");});
}
async function fileToPart(f) {
  if (f.type==="application/pdf"){const b=await toBase64(f);return{type:"document",source:{type:"base64",media_type:"application/pdf",data:b}};}
  if (["image/jpeg","image/png","image/webp","image/gif"].includes(f.type)){const b=await toBase64(f);return{type:"image",source:{type:"base64",media_type:f.type,data:b}};}
  if (["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-excel"].includes(f.type)){
    try{
      const XLSX=await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
      const ab=await f.arrayBuffer();const wb=XLSX.read(ab,{type:"array"});
      const txt=wb.SheetNames.map(n=>`[Sheet:${n}]\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join("\n\n");
      return{type:"text",text:`[Excel:${f.name}]\n${txt}`};
    }catch{return{type:"text",text:`[Excel:${f.name}] 파싱실패`};}
  }
  const txt=await readText(f);return{type:"text",text:`[${f.name}]\n${txt}`};
}

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [blNo, setBlNo] = useState("");
  const [activeBlNo, setActiveBlNo] = useState("");
  const [files, setFiles] = useState([]);
  const [unified, setUnified] = useState({}); // { fieldKey: [{value, sources}] }
  const [loading, setLoading] = useState(false);
  const [loadingJob, setLoadingJob] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState({});
  const [showExport, setShowExport] = useState(false);
  const [blList, setBlList] = useState([]);
  const fileRef = useRef();

  useEffect(()=>{ fetchBlList(); },[]);

  const fetchBlList = async () => {
    try { const r=await fetch('/api/bl-list'); const d=await r.json(); setBlList(d.list||[]); } catch {}
  };

  const startJob = async (bl) => {
    const target=(bl||blNo).trim();
    if(!target) return;
    setActiveBlNo(target); setBlNo(target);
    setFiles([]); setUnified({}); setError("");
    setLoadingJob(true);
    try {
      const r=await fetch(`/api/extract?blNo=${encodeURIComponent(target)}`);
      if(r.ok){ const d=await r.json(); if(d.unified) setUnified(d.unified); }
    } catch {}
    setLoadingJob(false);
  };

  const addFiles = fl => {
    const arr=Array.from(fl).filter(f=>ALLOWED.includes(f.type));
    if(!arr.length){setError("지원: PDF·JPG·PNG·XLSX·TXT·CSV");return;}
    setFiles(p=>[...p,...arr]); setError("");
  };
  const onDrop=useCallback(e=>{e.preventDefault();setDragging(false);addFiles(e.dataTransfer.files);},[]);

  const extractAll = async () => {
    if(!apiKey){setError("Settings에서 API Key를 먼저 입력해주세요.");return;}
    if(!files.length){setError("파일을 먼저 올려주세요.");return;}
    setLoading(true); setError("");
    try {
      const parts=await Promise.all(files.map(fileToPart));
      const r=await fetch("/api/extract",{
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":apiKey},
        body:JSON.stringify({parts, blNo:activeBlNo, existingUnified:unified}),
      });
      const d=await r.json();
      if(d.error) throw new Error(d.error);
      setUnified(d.unified);
      setFiles([]);
      fetchBlList();
    } catch(e){setError("추출 실패: "+e.message);}
    setLoading(false);
  };

  const copyText=(key,val)=>{
    navigator.clipboard.writeText(val);
    setCopied(p=>({...p,[key]:true}));
    setTimeout(()=>setCopied(p=>({...p,[key]:false})),1500);
  };

  const hasMismatch = (entries) => entries && entries.length > 1;
  const mismatchCount = Object.values(unified).filter(entries => hasMismatch(entries)).length;

  const exportText = Object.keys(unified).length ? [
    `BL No: ${activeBlNo}`, `추출일시: ${new Date().toLocaleString('ko-KR')}`, "",
    ...SECTIONS.flatMap(sec => {
      const lines = sec.fields.flatMap(f => {
        const entries = unified[f.key];
        if(!entries?.length) return [];
        if(entries.length===1){
          return [`${f.label}: ${entries[0].value}  [${entries[0].sources.join(', ')}]`];
        }
        return [`${f.label}:`, ...entries.map(e=>`  • ${e.value}  [${e.sources.join(', ')}]`)];
      });
      if(!lines.length) return [];
      return [`\n▶ ${sec.title}`, ...lines];
    })
  ].join("\n") : "";

  const C = {
    sidebar:{width:220,background:"#1a1a2e",color:"white",flexShrink:0,display:"flex",flexDirection:"column",minHeight:"100vh"},
    card:{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",marginBottom:16},
    sectionTitle:{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:10,paddingBottom:6,borderBottom:"1px solid #f0f0f0"},
  };

  // Render a unified field row
  const FieldRow = ({ fieldKey, label }) => {
    const entries = unified[fieldKey];
    if(!entries?.length) return (
      <div style={{display:"flex",alignItems:"flex-start",padding:"7px 0",borderBottom:"1px solid #f8f8f8",gap:12}}>
        <span style={{fontSize:12,color:"#ccc",minWidth:185,flexShrink:0}}>{label}</span>
        <span style={{fontSize:13,color:"#ddd"}}>—</span>
      </div>
    );

    const isMismatch = entries.length > 1;

    return (
      <div style={{padding:"7px 0",borderBottom:"1px solid #f8f8f8"}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
          <span style={{fontSize:12,color:"#aaa",minWidth:185,flexShrink:0,paddingTop:2}}>{label}</span>
          <div style={{flex:1}}>
            {isMismatch && (
              <span style={{display:"inline-block",fontSize:10,fontWeight:700,color:"#c62828",background:"#ffebee",borderRadius:4,padding:"1px 6px",marginBottom:6}}>
                ❌ 불일치
              </span>
            )}
            {entries.map((entry, i) => (
              <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:entries.length>1?6:0}}>
                <div style={{flex:1}}>
                  <span style={{fontSize:13,color:"#222",lineHeight:1.6,wordBreak:"break-all"}}>{entry.value}</span>
                  <span style={{fontSize:11,color:"#aaa",marginLeft:6,background:"#f5f5f5",borderRadius:4,padding:"1px 6px",whiteSpace:"nowrap"}}>
                    {entry.sources.join(' · ')}
                  </span>
                </div>
                <button onClick={()=>copyText(`${fieldKey}-${i}`,entry.value)}
                  style={{fontSize:11,padding:"2px 9px",borderRadius:4,border:"1px solid #e0e0e0",background:copied[`${fieldKey}-${i}`]?"#e8f5e9":"#fafafa",cursor:"pointer",color:copied[`${fieldKey}-${i}`]?"#2e7d32":"#666",whiteSpace:"nowrap",flexShrink:0}}>
                  {copied[`${fieldKey}-${i}`]?"✓":"복사"}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <Head><title>🚢 FF Data Extractor</title></Head>
      <div style={{display:"flex",minHeight:"100vh",fontFamily:"system-ui,sans-serif",background:"#f0f2f5"}}>

        {/* Sidebar */}
        <div style={C.sidebar}>
          <div style={{padding:"20px 16px 14px",borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
            <div style={{fontSize:16,fontWeight:700}}>🚢 FF Extractor</div>
            <div style={{fontSize:11,opacity:0.45,marginTop:3}}>서정인터내셔날</div>
          </div>
          <div style={{padding:"12px 16px 4px",fontSize:10,opacity:0.4,textTransform:"uppercase",letterSpacing:1}}>작업 목록</div>
          <div style={{flex:1,overflowY:"auto"}}>
            {blList.length===0&&<div style={{padding:"8px 16px",fontSize:12,opacity:0.35}}>저장된 작업 없음</div>}
            {blList.map(bl=>(
              <div key={bl} onClick={()=>startJob(bl)}
                style={{padding:"10px 16px",cursor:"pointer",fontSize:13,
                  background:activeBlNo===bl?"rgba(255,255,255,0.12)":"transparent",
                  borderLeft:activeBlNo===bl?"3px solid #60a5fa":"3px solid transparent",transition:"all 0.15s"}}>
                <div style={{fontWeight:activeBlNo===bl?700:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",opacity:activeBlNo===bl?1:0.75}}>{bl}</div>
              </div>
            ))}
          </div>
          <div style={{padding:"12px 16px",borderTop:"1px solid rgba(255,255,255,0.08)"}}>
            <button onClick={()=>setShowSettings(p=>!p)} style={{width:"100%",padding:"8px 0",background:"rgba(255,255,255,0.1)",color:"white",border:"none",borderRadius:8,cursor:"pointer",fontSize:13}}>
              ⚙️ Settings
            </button>
          </div>
        </div>

        {/* Main */}
        <div style={{flex:1,overflowY:"auto"}}>
          <div style={{maxWidth:920,margin:"0 auto",padding:24}}>

            {showSettings&&(
              <div style={C.card}>
                <div style={{fontSize:13,fontWeight:700,marginBottom:12}}>⚙️ API Key 설정</div>
                <div style={{display:"flex",gap:8}}>
                  <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="sk-ant-..."
                    style={{flex:1,padding:"9px 13px",border:"1px solid #ddd",borderRadius:8,fontSize:13,outline:"none"}}/>
                  <button onClick={()=>setShowSettings(false)} style={{padding:"9px 18px",background:"#1a1a2e",color:"white",border:"none",borderRadius:8,fontSize:13,cursor:"pointer",fontWeight:600}}>확인</button>
                </div>
              </div>
            )}

            {/* BL Input */}
            <div style={C.card}>
              <div style={{fontSize:12,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>BL No. 입력</div>
              <div style={{display:"flex",gap:10}}>
                <input value={blNo} onChange={e=>setBlNo(e.target.value)} onKeyDown={e=>e.key==="Enter"&&startJob()} placeholder="예) COSU1234567890"
                  style={{flex:1,padding:"11px 16px",border:"2px solid #e0e0e0",borderRadius:10,fontSize:15,fontWeight:600,outline:"none"}}/>
                <button onClick={()=>startJob()} style={{padding:"11px 24px",background:"#1a1a2e",color:"white",border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer"}}>시작</button>
              </div>
            </div>

            {activeBlNo&&(
              <>
                {loadingJob&&<div style={{textAlign:"center",padding:30,color:"#888"}}>⏳ 저장된 데이터 불러오는 중...</div>}

                {/* Upload */}
                <div style={C.card}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div>
                      <span style={{fontSize:15,fontWeight:700,color:"#1a1a2e"}}>📦 {activeBlNo}</span>
                      {mismatchCount>0&&<span style={{marginLeft:10,fontSize:12,fontWeight:700,color:"#c62828",background:"#ffebee",borderRadius:20,padding:"3px 10px"}}>❌ 불일치 {mismatchCount}건</span>}
                    </div>
                    <button onClick={()=>{setFiles([]);setUnified({});setError("");}}
                      style={{fontSize:12,padding:"5px 12px",borderRadius:6,border:"1px solid #eee",background:"white",cursor:"pointer",color:"#888"}}>초기화</button>
                  </div>

                  <div onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={onDrop} onClick={()=>fileRef.current.click()}
                    style={{border:`2px dashed ${dragging?"#1a1a2e":"#d0d0d0"}`,borderRadius:12,padding:"24px 20px",textAlign:"center",cursor:"pointer",background:dragging?"#f0f0ff":"#fafafa",marginBottom:12,transition:"all 0.2s"}}>
                    <div style={{fontSize:30,marginBottom:6}}>📂</div>
                    <div style={{fontSize:14,color:"#555",fontWeight:600}}>MBL · HBL · CI · PL · 수출면장 · Booking Sheet 한번에</div>
                    <div style={{fontSize:12,color:"#aaa",marginTop:3}}>PDF · JPG · PNG · XLSX · TXT · CSV</div>
                    <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.txt,.csv" style={{display:"none"}} onChange={e=>addFiles(e.target.files)}/>
                  </div>

                  {files.map((f,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",background:"#f5f5f5",borderRadius:8,marginBottom:5,fontSize:13}}>
                      <span>{FICONS[f.type]||"📎"}</span>
                      <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</span>
                      <span style={{color:"#bbb",fontSize:11}}>{(f.size/1024).toFixed(0)}KB</span>
                      <button onClick={()=>setFiles(p=>p.filter((_,j)=>j!==i))} style={{border:"none",background:"none",cursor:"pointer",color:"#ccc",fontSize:15}}>✕</button>
                    </div>
                  ))}

                  {error&&<div style={{color:"#c00",fontSize:12,margin:"8px 0"}}>{error}</div>}

                  <div style={{display:"flex",gap:10,marginTop:4}}>
                    <button onClick={extractAll} disabled={loading||!files.length}
                      style={{flex:1,padding:"12px 0",background:loading||!files.length?"#ccc":"#1a1a2e",color:"white",border:"none",borderRadius:10,fontSize:15,fontWeight:700,cursor:loading||!files.length?"not-allowed":"pointer"}}>
                      {loading?"⏳ 추출 중...":Object.keys(unified).length>0?"🔍 추가 파일 추출 (누적)":"🔍 추출하기"}
                    </button>
                    {Object.keys(unified).length>0&&(
                      <button onClick={()=>setShowExport(true)}
                        style={{padding:"12px 18px",borderRadius:10,border:"1px solid #ddd",background:"white",color:"#555",fontSize:13,cursor:"pointer",fontWeight:600}}>
                        📑 내보내기
                      </button>
                    )}
                  </div>
                </div>

                {/* Unified Result */}
                {Object.keys(unified).length>0&&(
                  <div style={C.card}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
                      <div style={{fontSize:15,fontWeight:700,color:"#1a1a2e"}}>📋 통합 추출 결과</div>
                      {mismatchCount>0&&(
                        <div style={{fontSize:12,color:"#c62828",background:"#ffebee",borderRadius:8,padding:"6px 12px",fontWeight:600}}>
                          ⚠️ {mismatchCount}개 항목 불일치 — 확인 필요
                        </div>
                      )}
                    </div>
                    {SECTIONS.map(sec=>(
                      <div key={sec.title} style={{marginBottom:24}}>
                        <div style={C.sectionTitle}>{sec.title}</div>
                        {sec.fields.map(f=><FieldRow key={f.key} fieldKey={f.key} label={f.label}/>)}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Export Modal */}
        {showExport&&(
          <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
            onClick={e=>e.target===e.currentTarget&&setShowExport(false)}>
            <div style={{background:"white",borderRadius:14,padding:24,maxWidth:660,width:"100%",maxHeight:"82vh",display:"flex",flexDirection:"column"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <span style={{fontWeight:700,fontSize:15}}>📋 {activeBlNo} 전체 추출 내용</span>
                <button onClick={()=>setShowExport(false)} style={{border:"none",background:"none",fontSize:22,cursor:"pointer",color:"#aaa"}}>✕</button>
              </div>
              <textarea readOnly value={exportText} style={{flex:1,minHeight:360,fontFamily:"monospace",fontSize:11,border:"1px solid #eee",borderRadius:8,padding:12,resize:"none",outline:"none",margin:"12px 0"}}/>
              <button onClick={()=>navigator.clipboard.writeText(exportText)}
                style={{padding:"11px 0",background:"#1a1a2e",color:"white",border:"none",borderRadius:9,fontSize:14,fontWeight:700,cursor:"pointer"}}>
                📑 전체 복사
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
