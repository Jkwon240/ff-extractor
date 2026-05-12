import { useState, useRef, useCallback, useEffect } from "react";
import Head from "next/head";

const ALL_FIELDS = [
  { key: "shipper", label: "Shipper" },
  { key: "consignee", label: "Consignee" },
  { key: "notify_party", label: "Notify Party" },
  { key: "port_of_loading", label: "Port of Loading (POL)" },
  { key: "port_of_discharge", label: "Port of Discharge (POD)" },
  { key: "vessel", label: "Vessel / Voyage" },
  { key: "etd", label: "ETD" },
  { key: "eta", label: "ETA" },
  { key: "container_no", label: "Container No." },
  { key: "seal_no", label: "Seal No." },
  { key: "hs_code", label: "HS Code" },
  { key: "description", label: "Description of Goods" },
  { key: "commodity", label: "Commodity" },
  { key: "gross_weight", label: "Gross Weight" },
  { key: "measurement", label: "Measurement (CBM)" },
  { key: "package_count", label: "Package Count / Type" },
  { key: "invoice_no", label: "Invoice No." },
  { key: "invoice_value", label: "Invoice Value" },
  { key: "incoterms", label: "Incoterms" },
  { key: "freight_terms", label: "Freight Terms" },
  { key: "shipper_ref", label: "Shipper's Ref / PO No." },
  { key: "bl_no", label: "B/L No." },
];

const CHECK_FIELDS = [
  { key: "gross_weight", label: "Gross Weight" },
  { key: "package_count", label: "Package Count" },
  { key: "container_no", label: "Container No." },
  { key: "seal_no", label: "Seal No." },
  { key: "measurement", label: "Measurement (CBM)" },
];

const DOC_COLORS = {
  MBL: "#1a1a2e", HBL: "#1565c0", "수출면장": "#6a1b9a",
  CI: "#2e7d32", PL: "#e65100", Invoice: "#bf360c", "기타": "#546e7a",
};

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
    try{const XLSX=(await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs"));const ab=await f.arrayBuffer();const wb=XLSX.read(ab,{type:"array"});const txt=wb.SheetNames.map(n=>`[Sheet:${n}]\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join("\n\n");return{type:"text",text:`[Excel:${f.name}]\n${txt}`};}
    catch{return{type:"text",text:`[Excel:${f.name}] 파싱실패`};}
  }
  const txt=await readText(f);return{type:"text",text:`[${f.name}]\n${txt}`};
}

function normalize(v){if(!v)return null;return v.toString().toLowerCase().replace(/\s+/g," ").replace(/,/g,"").trim();}
function isSimilar(a,b){
  if(!a||!b)return null;
  const na=normalize(a),nb=normalize(b);
  if(na===nb)return true;
  const fa=parseFloat(na.replace(/[^0-9.]/g,"")),fb=parseFloat(nb.replace(/[^0-9.]/g,""));
  if(!isNaN(fa)&&!isNaN(fb)&&fa>0)return Math.abs(fa-fb)<0.01;
  if(na.includes(nb)||nb.includes(na))return true;
  return false;
}

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [blNo, setBlNo] = useState("");
  const [activeBlNo, setActiveBlNo] = useState("");
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [tab, setTab] = useState("result");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState({});
  const [showExport, setShowExport] = useState(false);
  const [blList, setBlList] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const fileRef = useRef();

  // Load BL list on mount
  useEffect(() => { fetchBlList(); }, []);

  const fetchBlList = async () => {
    try {
      const res = await fetch('/api/bl-list');
      const data = await res.json();
      setBlList(data.list || []);
    } catch {}
  };

  const startJob = async (bl) => {
    const target = bl || blNo.trim();
    if (!target) return;
    setActiveBlNo(target);
    setBlNo(target);
    setFiles([]); setResults([]); setError(""); setTab("result");
    // Try load from Redis
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/extract?blNo=${encodeURIComponent(target)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.results) { setResults(data.results); }
      }
    } catch {}
    setLoadingHistory(false);
  };

  const addFiles = (fl) => {
    const arr = Array.from(fl).filter(f=>ALLOWED.includes(f.type));
    if (!arr.length){setError("지원: PDF·JPG·PNG·XLSX·TXT·CSV");return;}
    setFiles(p=>[...p,...arr]); setError("");
  };
  const onDrop = useCallback(e=>{e.preventDefault();setDragging(false);addFiles(e.dataTransfer.files);},[]);

  const extractAll = async () => {
    if (!apiKey){setError("Settings에서 API Key를 먼저 입력해주세요.");return;}
    if (!files.length){setError("파일을 먼저 올려주세요.");return;}
    setLoading(true); setError("");
    try {
      const parts = await Promise.all(files.map(fileToPart));
      const res = await fetch("/api/extract", {
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":apiKey},
        body:JSON.stringify({parts, blNo:activeBlNo, existingResults:results}),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResults(p=>[...p,...data.results]);
      setFiles([]);
      setTab("result");
      fetchBlList();
    } catch(e){setError("추출 실패: "+e.message);}
    setLoading(false);
  };

  const crossCheck = () => {
    const out = {};
    CHECK_FIELDS.forEach(field=>{
      const entries=results.filter(d=>d[field.key]).map(d=>({label:d.doc_type+(d.doc_label?` (${d.doc_label})`:""),val:d[field.key],color:DOC_COLORS[d.doc_type]||"#546e7a"}));
      if(entries.length<2){out[field.key]={entries,status:"skip"};return;}
      const vals=entries.map(e=>e.val);
      out[field.key]={entries,status:vals.every(v=>isSimilar(v,vals[0]))?"ok":"mismatch"};
    });
    return out;
  };

  const mismatchCount = results.length>=2 ? Object.values(crossCheck()).filter(r=>r.status==="mismatch").length : 0;

  const copyText = (key,val)=>{
    navigator.clipboard.writeText(val);
    setCopied(p=>({...p,[key]:true}));
    setTimeout(()=>setCopied(p=>({...p,[key]:false})),1500);
  };

  const exportText = results.length ? [`BL No: ${activeBlNo}`,"", ...results.flatMap(doc=>[
    `=== ${doc.doc_type} ${doc.doc_label||""} ===`,
    ...ALL_FIELDS.filter(f=>doc[f.key]).map(f=>`${f.label}: ${doc[f.key]}`),""
  ])].join("\n") : "";

  const chk = crossCheck();

  return (
    <>
      <Head><title>🚢 FF Data Extractor</title></Head>
      <div style={{display:"flex",minHeight:"100vh",fontFamily:"system-ui,sans-serif",background:"#f0f2f5"}}>

        {/* Sidebar */}
        <div style={{width:220,background:"#1a1a2e",color:"white",flexShrink:0,display:"flex",flexDirection:"column"}}>
          <div style={{padding:"20px 16px 12px",borderBottom:"1px solid rgba(255,255,255,0.1)"}}>
            <div style={{fontSize:16,fontWeight:700}}>🚢 FF Extractor</div>
            <div style={{fontSize:11,opacity:0.5,marginTop:3}}>서정인터내셔날</div>
          </div>
          <div style={{padding:"12px 16px 6px",fontSize:11,opacity:0.5,textTransform:"uppercase",letterSpacing:1}}>작업 목록</div>
          <div style={{flex:1,overflowY:"auto"}}>
            {blList.length===0 && <div style={{padding:"8px 16px",fontSize:12,opacity:0.4}}>저장된 작업 없음</div>}
            {blList.map(bl=>(
              <div key={bl} onClick={()=>startJob(bl)}
                style={{padding:"10px 16px",cursor:"pointer",fontSize:13,background:activeBlNo===bl?"rgba(255,255,255,0.15)":"transparent",borderLeft:activeBlNo===bl?"3px solid #60a5fa":"3px solid transparent",transition:"all 0.15s"}}>
                <div style={{fontWeight:activeBlNo===bl?700:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{bl}</div>
              </div>
            ))}
          </div>
          <div style={{padding:"12px 16px",borderTop:"1px solid rgba(255,255,255,0.1)"}}>
            <button onClick={()=>setShowSettings(p=>!p)} style={{width:"100%",padding:"8px 0",background:"rgba(255,255,255,0.1)",color:"white",border:"none",borderRadius:8,cursor:"pointer",fontSize:13}}>
              ⚙️ Settings
            </button>
          </div>
        </div>

        {/* Main */}
        <div style={{flex:1,overflowY:"auto"}}>
          <div style={{maxWidth:900,margin:"0 auto",padding:24}}>

            {/* Settings */}
            {showSettings && (
              <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:700,marginBottom:12}}>⚙️ API Key 설정</div>
                <div style={{display:"flex",gap:8}}>
                  <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="sk-ant-..."
                    style={{flex:1,padding:"9px 13px",border:"1px solid #ddd",borderRadius:8,fontSize:13,outline:"none"}}/>
                  <button onClick={()=>setShowSettings(false)} style={{padding:"9px 18px",background:"#1a1a2e",color:"white",border:"none",borderRadius:8,fontSize:13,cursor:"pointer",fontWeight:600}}>확인</button>
                </div>
              </div>
            )}

            {/* BL Input */}
            <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>BL No. 입력</div>
              <div style={{display:"flex",gap:10}}>
                <input style={{flex:1,padding:"11px 16px",border:"2px solid #e0e0e0",borderRadius:10,fontSize:15,fontWeight:600,outline:"none"}}
                  value={blNo} onChange={e=>setBlNo(e.target.value)} placeholder="예) COSU1234567890" onKeyDown={e=>e.key==="Enter"&&startJob()}/>
                <button style={{padding:"11px 24px",background:"#1a1a2e",color:"white",border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer"}} onClick={()=>startJob()}>시작</button>
              </div>
            </div>

            {/* Work Area */}
            {activeBlNo && (
              <>
                {loadingHistory && <div style={{textAlign:"center",color:"#888",padding:20}}>⏳ 저장된 데이터 불러오는 중...</div>}

                <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",marginBottom:16}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div>
                      <span style={{fontSize:15,fontWeight:700,color:"#1a1a2e"}}>📦 {activeBlNo}</span>
                      <span style={{fontSize:12,color:"#aaa",marginLeft:8}}>{results.length>0?`${results.length}개 서류 추출됨`:"파일을 한번에 올려주세요"}</span>
                    </div>
                    <button onClick={()=>{setFiles([]);setResults([]);setError("");}} style={{fontSize:12,padding:"5px 12px",borderRadius:6,border:"1px solid #eee",background:"white",cursor:"pointer",color:"#888"}}>초기화</button>
                  </div>

                  <div style={{border:`2px dashed ${dragging?"#1a1a2e":"#d0d0d0"}`,borderRadius:12,padding:"28px 20px",textAlign:"center",cursor:"pointer",background:dragging?"#f0f0ff":"#fafafa",marginBottom:14}}
                    onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={onDrop} onClick={()=>fileRef.current.click()}>
                    <div style={{fontSize:32,marginBottom:6}}>📂</div>
                    <div style={{fontSize:14,color:"#555",fontWeight:600}}>MBL · HBL · CI · PL · 수출면장 한번에 드래그하거나 클릭</div>
                    <div style={{fontSize:12,color:"#aaa",marginTop:4}}>PDF · JPG · PNG · XLSX · TXT · CSV</div>
                    <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.txt,.csv" style={{display:"none"}} onChange={e=>addFiles(e.target.files)}/>
                  </div>

                  {files.map((f,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",background:"#f5f5f5",borderRadius:8,marginBottom:6,fontSize:13}}>
                      <span>{FICONS[f.type]||"📎"}</span>
                      <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</span>
                      <span style={{color:"#bbb",fontSize:11}}>{(f.size/1024).toFixed(0)}KB</span>
                      <button onClick={()=>setFiles(p=>p.filter((_,j)=>j!==i))} style={{border:"none",background:"none",cursor:"pointer",color:"#ccc",fontSize:16}}>✕</button>
                    </div>
                  ))}

                  {error && <div style={{color:"#c00",fontSize:12,margin:"8px 0"}}>{error}</div>}

                  <button style={{width:"100%",padding:"13px 0",background:loading?"#ccc":"#1a1a2e",color:"white",border:"none",borderRadius:10,fontSize:15,fontWeight:700,cursor:loading?"not-allowed":"pointer"}}
                    onClick={extractAll} disabled={loading}>
                    {loading?"⏳ 추출 중...":results.length>0?"🔍 추가 파일 추출":"🔍 추출하기"}
                  </button>
                </div>

                {results.length>0 && (
                  <>
                    <div style={{display:"flex",gap:8,marginBottom:18}}>
                      {[{key:"result",label:"📋 추출 결과"},{key:"check",label:`🔍 크로스체크 ${mismatchCount>0?`❌${mismatchCount}`:results.length>=2?"✅":""}`}].map(t=>(
                        <button key={t.key} onClick={()=>setTab(t.key)}
                          style={{padding:"9px 20px",borderRadius:9,border:"none",cursor:"pointer",fontSize:13,fontWeight:600,background:tab===t.key?"#1a1a2e":"white",color:tab===t.key?"white":"#888",boxShadow:"0 1px 3px rgba(0,0,0,0.08)"}}>
                          {t.label}
                        </button>
                      ))}
                      <button onClick={()=>setShowExport(true)} style={{marginLeft:"auto",padding:"9px 16px",borderRadius:9,border:"1px solid #ddd",background:"white",color:"#555",fontSize:13,cursor:"pointer",fontWeight:600}}>📑 내보내기</button>
                    </div>

                    {/* Result Tab */}
                    {tab==="result" && results.map((doc,di)=>{
                      const color=DOC_COLORS[doc.doc_type]||"#546e7a";
                      return (
                        <div key={di} style={{background:"white",borderRadius:12,padding:20,marginBottom:14,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",borderLeft:`4px solid ${color}`}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                            <div>
                              <span style={{display:"inline-block",padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:700,color:"white",background:color}}>{doc.doc_type}</span>
                              {doc.doc_label&&<span style={{fontSize:13,color:"#666",marginLeft:8}}>{doc.doc_label}</span>}
                            </div>
                            <button onClick={()=>{const t=ALL_FIELDS.filter(f=>doc[f.key]).map(f=>`${f.label}: ${doc[f.key]}`).join("\n");navigator.clipboard.writeText(t);}}
                              style={{fontSize:11,padding:"2px 10px",borderRadius:5,border:"1px solid #e0e0e0",background:"#fafafa",cursor:"pointer",color:"#666"}}>블록 전체 복사</button>
                          </div>
                          {ALL_FIELDS.map(f=>{
                            const val=doc[f.key]; const k=`${di}-${f.key}`;
                            return (
                              <div key={f.key} style={{display:"flex",alignItems:"flex-start",padding:"7px 0",borderBottom:"1px solid #f5f5f5",gap:12}}>
                                <span style={{fontSize:12,color:"#aaa",minWidth:185,flexShrink:0,paddingTop:1}}>{f.label}</span>
                                <span style={{fontSize:13,flex:1,wordBreak:"break-all",lineHeight:1.6,color:val?"#222":"#ddd"}}>{val||"—"}</span>
                                {val&&<button style={{fontSize:11,padding:"2px 10px",borderRadius:5,border:"1px solid #e0e0e0",background:copied[k]?"#e8f5e9":"#fafafa",cursor:"pointer",color:copied[k]?"#2e7d32":"#666",whiteSpace:"nowrap",flexShrink:0}} onClick={()=>copyText(k,val)}>{copied[k]?"✓":"복사"}</button>}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}

                    {/* Check Tab */}
                    {tab==="check" && (
                      <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)"}}>
                        <div style={{fontSize:14,fontWeight:700,marginBottom:16}}>🔍 크로스체크 — {activeBlNo}</div>
                        <div style={{display:"flex",gap:10,marginBottom:20}}>
                          {[{label:"일치",count:Object.values(chk).filter(r=>r.status==="ok").length,bg:"#e8f5e9",color:"#2e7d32"},
                            {label:"불일치",count:mismatchCount,bg:mismatchCount>0?"#ffebee":"#f5f5f5",color:mismatchCount>0?"#c62828":"#aaa"},
                            {label:"데이터 부족",count:Object.values(chk).filter(r=>r.status==="skip").length,bg:"#f5f5f5",color:"#aaa"}
                          ].map(b=>(
                            <div key={b.label} style={{flex:1,padding:14,borderRadius:10,textAlign:"center",background:b.bg}}>
                              <div style={{fontSize:26,fontWeight:800,color:b.color}}>{b.count}</div>
                              <div style={{fontSize:12,color:b.color}}>{b.label}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{overflowX:"auto"}}>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                            <thead>
                              <tr style={{background:"#f8f8f8"}}>
                                <th style={{padding:"10px 14px",textAlign:"left",fontSize:11,fontWeight:700,borderBottom:"2px solid #eee",color:"#666"}}>항목</th>
                                {results.map((doc,i)=><th key={i} style={{padding:"10px 14px",textAlign:"left",fontSize:11,fontWeight:700,borderBottom:"2px solid #eee",color:DOC_COLORS[doc.doc_type]||"#546e7a"}}>{doc.doc_type}{doc.doc_label?` (${doc.doc_label})`:""}</th>)}
                                <th style={{padding:"10px 14px",textAlign:"center",fontSize:11,fontWeight:700,borderBottom:"2px solid #eee",color:"#666",width:60}}>결과</th>
                              </tr>
                            </thead>
                            <tbody>
                              {CHECK_FIELDS.map(field=>{
                                const r=chk[field.key]; const isMM=r.status==="mismatch";
                                return (
                                  <tr key={field.key} style={{background:isMM?"#fff5f5":"white"}}>
                                    <td style={{padding:"10px 14px",fontWeight:600,color:"#444",borderBottom:"1px solid #f0f0f0"}}>{field.label}</td>
                                    {results.map((doc,i)=>{
                                      const val=doc[field.key];
                                      const differs=isMM&&val&&r.entries.filter(e=>e.val!==val).some(e=>!isSimilar(val,e.val));
                                      return <td key={i} style={{padding:"10px 14px",borderBottom:"1px solid #f0f0f0",color:differs?"#c62828":"#333",fontWeight:differs?700:400}}>{val||<span style={{color:"#ddd"}}>—</span>}</td>;
                                    })}
                                    <td style={{padding:"10px 14px",textAlign:"center",borderBottom:"1px solid #f0f0f0"}}>{r.status==="ok"?"✅":r.status==="mismatch"?"❌":"—"}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <div style={{padding:"12px 16px",borderRadius:10,fontSize:13,fontWeight:600,marginTop:16,background:mismatchCount>0?"#ffebee":"#e8f5e9",color:mismatchCount>0?"#c62828":"#2e7d32"}}>
                          {mismatchCount>0?"⚠️ 불일치 항목이 있어요. 서류를 다시 확인해주세요.":"✅ 체크 항목이 모두 일치해요!"}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Export Modal */}
        {showExport&&(
          <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={e=>e.target===e.currentTarget&&setShowExport(false)}>
            <div style={{background:"white",borderRadius:14,padding:24,maxWidth:660,width:"100%",maxHeight:"82vh",display:"flex",flexDirection:"column"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <span style={{fontWeight:700,fontSize:15}}>📋 전체 추출 내용 — {activeBlNo}</span>
                <button onClick={()=>setShowExport(false)} style={{border:"none",background:"none",fontSize:22,cursor:"pointer",color:"#aaa"}}>✕</button>
              </div>
              <textarea readOnly value={exportText} style={{flex:1,minHeight:360,fontFamily:"monospace",fontSize:11,border:"1px solid #eee",borderRadius:8,padding:12,resize:"none",outline:"none",margin:"12px 0"}}/>
              <button onClick={()=>navigator.clipboard.writeText(exportText)} style={{padding:"11px 0",background:"#1a1a2e",color:"white",border:"none",borderRadius:9,fontSize:14,fontWeight:700,cursor:"pointer"}}>📑 전체 복사</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
