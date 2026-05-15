import { useState, useRef, useCallback, useEffect } from "react";
import Head from "next/head";

const STATUSES = [
  { key: "all", label: "전체", color: "#555", bg: "#f0f0f0" },
  { key: "ongoing", label: "진행중", color: "#1565c0", bg: "#e3f2fd" },
  { key: "docs_done", label: "서류완료", color: "#6a1b9a", bg: "#f3e5f5" },
  { key: "shipped", label: "선적완료", color: "#e65100", bg: "#fff3e0" },
  { key: "done", label: "완료", color: "#2e7d32", bg: "#e8f5e9" },
];

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
    { key: "place_of_receipt", label: "Place of Receipt" },
    { key: "place_of_delivery", label: "Place of Delivery" },
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
    { key: "surrender_type", label: "Surrender Type" },
    { key: "place_of_issue", label: "Place of Issue" },
  ]},
];

const ALL_FIELDS = SECTIONS.flatMap(s => s.fields);
const ALLOWED = ["application/pdf","image/jpeg","image/png","image/webp","image/gif","text/plain","text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-excel"];
const FICONS = {"application/pdf":"📄","image/jpeg":"🖼️","image/png":"🖼️","image/webp":"🖼️",
  "text/plain":"📝","text/csv":"📝","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"📊","application/vnd.ms-excel":"📊"};

async function toBase64(f){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(f);});}
async function readText(f){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsText(f,"utf-8");});}
async function fileToPart(f){
  if(f.type==="application/pdf"){const b=await toBase64(f);return{type:"document",source:{type:"base64",media_type:"application/pdf",data:b}};}
  if(["image/jpeg","image/png","image/webp","image/gif"].includes(f.type)){const b=await toBase64(f);return{type:"image",source:{type:"base64",media_type:f.type,data:b}};}
  if(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-excel"].includes(f.type)){
    try{const XLSX=await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");const ab=await f.arrayBuffer();const wb=XLSX.read(ab,{type:"array"});const txt=wb.SheetNames.map(n=>`[Sheet:${n}]\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join("\n\n");return{type:"text",text:`[Excel:${f.name}]\n${txt}`};}
    catch{return{type:"text",text:`[Excel:${f.name}] 파싱실패`};}
  }
  const txt=await readText(f);return{type:"text",text:`[${f.name}]\n${txt}`};
}

function getDday(dateStr){
  if(!dateStr)return null;
  const match=dateStr.match(/(\d{4}[-./]\d{1,2}[-./]\d{1,2})/);
  if(!match)return null;
  const d=new Date(match[1].replace(/[./]/g,'-'));
  if(isNaN(d))return null;
  return Math.ceil((d-new Date())/86400000);
}

function DdayBadge({dateStr}){
  const d=getDday(dateStr);
  if(d===null)return null;
  const color=d<0?'#999':d<=1?'#c62828':d<=3?'#e65100':'#2e7d32';
  const bg=d<0?'#f5f5f5':d<=1?'#ffebee':d<=3?'#fff3e0':'#e8f5e9';
  const label=d<0?`D+${Math.abs(d)}`:d===0?'D-DAY':`D-${d}`;
  return <span style={{fontSize:10,fontWeight:700,color,background:bg,borderRadius:4,padding:'1px 5px',marginLeft:6}}>{label}</span>;
}

export default function Home(){
  const [apiKey,setApiKey]=useState(()=>typeof window!=='undefined'?localStorage.getItem("ff_api_key")||"":"");
  const [showSettings,setShowSettings]=useState(false);
  const [blNo,setBlNo]=useState("");
  const [activeBlNo,setActiveBlNo]=useState("");
  const [files,setFiles]=useState([]);
  const [unified,setUnified]=useState({});
  const [jobMeta,setJobMeta]=useState({status:"ongoing",memo:"",manager:""});
  const [loading,setLoading]=useState(false);
  const [loadingJob,setLoadingJob]=useState(false);
  const [error,setError]=useState("");
  const [dragging,setDragging]=useState(false);
  const [copied,setCopied]=useState({});
  const [showExport,setShowExport]=useState(false);
  const [showTemplate,setShowTemplate]=useState(false);
  const [blList,setBlList]=useState([]);
  const [blStatusMap,setBlStatusMap]=useState({});
  const [search,setSearch]=useState("");
  const [statusFilter,setStatusFilter]=useState("all");
  const [editingField,setEditingField]=useState(null);
  const [editValue,setEditValue]=useState("");
  const fileRef=useRef();

  useEffect(()=>{fetchBlList();},[]);

  const fetchBlList=async()=>{
    try{const r=await fetch('/api/bl-list');const d=await r.json();setBlList(d.list||[]);setBlStatusMap(d.statusMap||{});}catch{}
  };

  const startJob=async(bl)=>{
    const target=(bl||blNo).trim();
    if(!target)return;
    setActiveBlNo(target);setBlNo(target);
    setFiles([]);setUnified({});setError("");
    setJobMeta({status:"ongoing",memo:"",manager:""});
    setLoadingJob(true);
    try{
      const r=await fetch(`/api/extract?blNo=${encodeURIComponent(target)}`);
      if(r.ok){const d=await r.json();if(d.unified)setUnified(d.unified);if(d.status||d.memo||d.manager)setJobMeta({status:d.status||"ongoing",memo:d.memo||"",manager:d.manager||""});}
    }catch{}
    setLoadingJob(false);
  };

  const deleteJob=async(bl)=>{
    if(!confirm(`"${bl}" 작업을 삭제할까요?`))return;
    try{
      await fetch(`/api/extract?blNo=${encodeURIComponent(bl)}`,{method:"DELETE"});
      if(activeBlNo===bl){setActiveBlNo("");setUnified({});setBlNo("");}
      fetchBlList();
    }catch{}
  };

  const addFiles=fl=>{
    const arr=Array.from(fl).filter(f=>ALLOWED.includes(f.type));
    if(!arr.length){setError("지원: PDF·JPG·PNG·XLSX·TXT·CSV");return;}
    setFiles(p=>[...p,...arr]);setError("");
  };
  const onDrop=useCallback(e=>{e.preventDefault();setDragging(false);addFiles(e.dataTransfer.files);},[]);

  const extractAll=async()=>{
    if(!apiKey){setError("Settings에서 API Key를 먼저 입력해주세요.");return;}
    if(!files.length){setError("파일을 먼저 올려주세요.");return;}
    setLoading(true);setError("");
    try{
      const parts=await Promise.all(files.map(fileToPart));
      const r=await fetch("/api/extract",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":apiKey},body:JSON.stringify({parts,blNo:activeBlNo,existingUnified:unified})});
      const d=await r.json();
      if(d.error)throw new Error(d.error);
      setUnified(d.unified);setFiles([]);fetchBlList();
    }catch(e){setError("추출 실패: "+e.message);}
    setLoading(false);
  };

  const saveMeta=async(updates)=>{
    const newMeta={...jobMeta,...updates};
    setJobMeta(newMeta);
    try{await fetch("/api/extract",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({blNo:activeBlNo,...newMeta})});}catch{}
    fetchBlList();
  };

  const saveFieldEdit=async(fieldKey,value)=>{
    try{
      const r=await fetch("/api/extract",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({blNo:activeBlNo,fieldKey,value,source:"직접입력"})});
      const d=await r.json();if(d.unified)setUnified(d.unified);
    }catch{}
    setEditingField(null);
  };

  const deleteEntry=async(fieldKey,idx)=>{
    const newEntries=(unified[fieldKey]||[]).filter((_,i)=>i!==idx);
    const newUnified={...unified,[fieldKey]:newEntries};
    setUnified(newUnified);
    try{await fetch("/api/extract",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({blNo:activeBlNo,fieldKey,allEntries:newEntries})});}catch{}
  };

  const copyText=(key,val)=>{
    navigator.clipboard.writeText(val);
    setCopied(p=>({...p,[key]:true}));
    setTimeout(()=>setCopied(p=>({...p,[key]:false})),1500);
  };

  const getFirstVal=key=>unified[key]?.[0]?.value||"";

  const erpTemplate=`=== 유한ERP (글로벌원) HBL 입력 ===
[B/L Base]
Freight Term: ${getFirstVal("freight_terms")}
Packages: ${getFirstVal("package_count")}
Gross Weight KGS: ${getFirstVal("gross_weight")}
Measurement CBM: ${getFirstVal("measurement")}
Container Type: ${getFirstVal("container_type")}
Description of Goods:
${getFirstVal("description")}
Total Containers (in words): ${getFirstVal("container_type")}
Container No / Seal No: ${getFirstVal("container_no")} / ${getFirstVal("seal_no")}

[B/L Other]
Shipper: ${getFirstVal("shipper")}
Consignee: ${getFirstVal("consignee")}
Notify Party: ${getFirstVal("notify_party")}
Vessel: ${getFirstVal("vessel")}
Place of Receipt: ${getFirstVal("place_of_receipt")}
Port of Loading: ${getFirstVal("port_of_loading")}
ETD: ${getFirstVal("etd")}
Port of Discharge: ${getFirstVal("port_of_discharge")}
ETA: ${getFirstVal("eta")}
Place of Delivery: ${getFirstVal("place_of_delivery")}
Place of Issue: ${getFirstVal("place_of_issue")}
Surrender: ${getFirstVal("surrender_type")}

[Reference]
Invoice No: ${getFirstVal("invoice_no")}
HS Code: ${getFirstVal("hs_code")}
Booking No: ${getFirstVal("booking_no")}`;

  const exportText=Object.keys(unified).length?[
    `BL No: ${activeBlNo}`,
    `담당: ${jobMeta.manager||"-"}  |  상태: ${STATUSES.find(s=>s.key===jobMeta.status)?.label||"-"}`,
    `메모: ${jobMeta.memo||"-"}`,"",
    ...SECTIONS.flatMap(sec=>{
      const lines=sec.fields.flatMap(f=>{
        const entries=unified[f.key];
        if(!entries?.length)return[];
        if(entries.length===1)return[`${f.label}: ${entries[0].value}  [${entries[0].sources.join(', ')}]`];
        return[`${f.label}:`,...entries.map(e=>`  • ${e.value}  [${e.sources.join(', ')}]`)];
      });
      if(!lines.length)return[];
      return[`\n▶ ${sec.title}`,...lines];
    })
  ].join("\n"):"";

  const exportExcel=()=>{
    const rows=[["BL No","담당자","상태","Shipper","Consignee","POL","POD","Vessel","ETD","ETA","Container No","Container Type","Gross Weight","CBM","Invoice No","Invoice Value","Booking No","메모"]];
    rows.push([activeBlNo,jobMeta.manager,STATUSES.find(s=>s.key===jobMeta.status)?.label,
      getFirstVal("shipper"),getFirstVal("consignee"),getFirstVal("port_of_loading"),getFirstVal("port_of_discharge"),
      getFirstVal("vessel"),getFirstVal("etd"),getFirstVal("eta"),getFirstVal("container_no"),getFirstVal("container_type"),
      getFirstVal("gross_weight"),getFirstVal("measurement"),getFirstVal("invoice_no"),
      getFirstVal("invoice_value"),getFirstVal("booking_no"),jobMeta.memo]);
    const csv=rows.map(r=>r.map(c=>`"${String(c||"").replace(/"/g,'""')}"`).join(",")).join("\n");
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"}));
    a.download=`${activeBlNo}.csv`;a.click();
  };

  const filteredList=blList.filter(bl=>{
    const matchSearch=bl.toLowerCase().includes(search.toLowerCase());
    const matchStatus=statusFilter==="all"||blStatusMap[bl]===statusFilter||(statusFilter==="ongoing"&&!blStatusMap[bl]);
    return matchSearch&&matchStatus;
  });

  const currentStatus=STATUSES.find(s=>s.key===jobMeta.status)||STATUSES[1];

  const FieldRow=({fieldKey,label})=>{
    const entries=unified[fieldKey]||[];
    const isCutoff=["doc_cutoff","cargo_cutoff"].includes(fieldKey);
    const isEditing=editingField===fieldKey;
    return(
      <div style={{padding:"8px 0",borderBottom:"1px solid #f5f5f5"}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
          <span style={{fontSize:12,color:"#aaa",minWidth:185,flexShrink:0,paddingTop:2}}>{label}</span>
          <div style={{flex:1}}>
            {isEditing?(
              <div style={{display:"flex",gap:6}}>
                <input value={editValue} onChange={e=>setEditValue(e.target.value)}
                  style={{flex:1,padding:"5px 8px",border:"1px solid #1a1a2e",borderRadius:6,fontSize:13,outline:"none"}}
                  onKeyDown={e=>{if(e.key==="Enter")saveFieldEdit(fieldKey,editValue);if(e.key==="Escape")setEditingField(null);}}
                  autoFocus/>
                <button onClick={()=>saveFieldEdit(fieldKey,editValue)} style={{padding:"5px 12px",background:"#1a1a2e",color:"white",border:"none",borderRadius:6,cursor:"pointer",fontSize:12}}>저장</button>
                <button onClick={()=>setEditingField(null)} style={{padding:"5px 10px",background:"#f5f5f5",border:"none",borderRadius:6,cursor:"pointer",fontSize:12}}>취소</button>
              </div>
            ):entries.length===0?(
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:13,color:"#ddd"}}>—</span>
                <button onClick={()=>{setEditingField(fieldKey);setEditValue("");}} style={{fontSize:11,padding:"1px 8px",borderRadius:4,border:"1px dashed #ddd",background:"none",cursor:"pointer",color:"#bbb"}}>+ 입력</button>
              </div>
            ):(
              entries.map((entry,i)=>(
                <div key={i} style={{display:"flex",alignItems:"flex-start",gap:6,marginBottom:entries.length>1?6:0}}>
                  <div style={{flex:1}}>
                    <span style={{fontSize:13,color:"#222",lineHeight:1.6,wordBreak:"break-all"}}>{entry.value}</span>
                    {isCutoff&&<DdayBadge dateStr={entry.value}/>}
                    <span style={{fontSize:11,color:"#aaa",marginLeft:6,background:"#f5f5f5",borderRadius:4,padding:"1px 5px"}}>{entry.sources.join(' · ')}</span>
                  </div>
                  <div style={{display:"flex",gap:4,flexShrink:0}}>
                    <button onClick={()=>copyText(`${fieldKey}-${i}`,entry.value)}
                      style={{fontSize:11,padding:"2px 8px",borderRadius:4,border:"1px solid #e0e0e0",background:copied[`${fieldKey}-${i}`]?"#e8f5e9":"#fafafa",cursor:"pointer",color:copied[`${fieldKey}-${i}`]?"#2e7d32":"#666"}}>
                      {copied[`${fieldKey}-${i}`]?"✓":"복사"}
                    </button>
                    <button onClick={()=>{setEditingField(fieldKey);setEditValue(entry.value);}}
                      style={{fontSize:11,padding:"2px 8px",borderRadius:4,border:"1px solid #e0e0e0",background:"#fafafa",cursor:"pointer",color:"#888"}}>✏️</button>
                    <button onClick={()=>deleteEntry(fieldKey,i)}
                      style={{fontSize:11,padding:"2px 8px",borderRadius:4,border:"1px solid #fcc",background:"#fff5f5",cursor:"pointer",color:"#c62828"}}>🗑</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  return(
    <>
      <Head><title>🚢 FF Data Extractor</title></Head>
      <div style={{display:"flex",minHeight:"100vh",fontFamily:"system-ui,sans-serif",background:"#f0f2f5"}}>

        {/* Sidebar */}
        <div style={{width:230,background:"#1a1a2e",color:"white",flexShrink:0,display:"flex",flexDirection:"column",minHeight:"100vh"}}>
          <div style={{padding:"18px 16px 14px",borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
            <div style={{fontSize:16,fontWeight:700}}>🚢 FF Extractor</div>
            <div style={{fontSize:11,opacity:0.45,marginTop:3}}>서정인터내셔날</div>
          </div>

          {/* Search */}
          <div style={{padding:"10px 12px",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 BL # 검색..."
              style={{width:"100%",padding:"7px 10px",background:"rgba(255,255,255,0.1)",border:"none",borderRadius:8,color:"white",fontSize:12,outline:"none",boxSizing:"border-box"}}/>
          </div>

          {/* Status filter */}
          <div style={{padding:"8px 10px",borderBottom:"1px solid rgba(255,255,255,0.06)",display:"flex",flexWrap:"wrap",gap:4}}>
            {STATUSES.map(s=>(
              <button key={s.key} onClick={()=>setStatusFilter(s.key)}
                style={{fontSize:10,padding:"3px 8px",borderRadius:10,border:"none",cursor:"pointer",
                  background:statusFilter===s.key?s.bg:"rgba(255,255,255,0.1)",
                  color:statusFilter===s.key?s.color:"rgba(255,255,255,0.6)",
                  fontWeight:statusFilter===s.key?700:400}}>
                {s.label}
              </button>
            ))}
          </div>

          {/* BL List */}
          <div style={{padding:"8px 0 4px 16px",fontSize:10,opacity:0.4,textTransform:"uppercase",letterSpacing:1}}>
            작업 목록 ({filteredList.length})
          </div>
          <div style={{flex:1,overflowY:"auto"}}>
            {filteredList.length===0&&<div style={{padding:"8px 16px",fontSize:12,opacity:0.35}}>없음</div>}
            {filteredList.map(bl=>{
              const st=STATUSES.find(s=>s.key===(blStatusMap[bl]||"ongoing"))||STATUSES[1];
              return(
                <div key={bl} style={{display:"flex",alignItems:"center",padding:"0 8px 0 0",
                  background:activeBlNo===bl?"rgba(255,255,255,0.12)":"transparent",
                  borderLeft:activeBlNo===bl?"3px solid #60a5fa":"3px solid transparent",transition:"all 0.15s"}}>
                  <div onClick={()=>startJob(bl)} style={{flex:1,padding:"10px 8px 10px 13px",cursor:"pointer",minWidth:0}}>
                    <div style={{fontWeight:activeBlNo===bl?700:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:13,opacity:activeBlNo===bl?1:0.75}}>{bl}</div>
                    <span style={{fontSize:10,padding:"1px 5px",borderRadius:8,background:st.bg,color:st.color,fontWeight:600}}>{st.label}</span>
                  </div>
                  <button onClick={e=>{e.stopPropagation();deleteJob(bl);}}
                    style={{border:"none",background:"none",cursor:"pointer",color:"rgba(255,255,255,0.3)",fontSize:14,padding:"4px",flexShrink:0}}
                    title="삭제">🗑</button>
                </div>
              );
            })}
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
              <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:700,marginBottom:12}}>⚙️ API Key 설정</div>
                <div style={{display:"flex",gap:8}}>
                  <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="sk-ant-..."
                    style={{flex:1,padding:"9px 13px",border:"1px solid #ddd",borderRadius:8,fontSize:13,outline:"none"}}/>
                  <button onClick={()=>{localStorage.setItem("ff_api_key",apiKey);setShowSettings(false);alert("저장됐어요!");}}
                    style={{padding:"9px 18px",background:"#1a1a2e",color:"white",border:"none",borderRadius:8,fontSize:13,cursor:"pointer",fontWeight:600}}>저장</button>
                </div>
              </div>
            )}

            {/* BL Input */}
            <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>BL No. 입력</div>
              <div style={{display:"flex",gap:10}}>
                <input value={blNo} onChange={e=>setBlNo(e.target.value)} onKeyDown={e=>e.key==="Enter"&&startJob()} placeholder="예) SJSEL2605001"
                  style={{flex:1,padding:"11px 16px",border:"2px solid #e0e0e0",borderRadius:10,fontSize:15,fontWeight:600,outline:"none"}}/>
                <button onClick={()=>startJob()} style={{padding:"11px 24px",background:"#1a1a2e",color:"white",border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer"}}>시작</button>
              </div>
            </div>

            {activeBlNo&&(
              <>
                {loadingJob&&<div style={{textAlign:"center",padding:30,color:"#888"}}>⏳ 불러오는 중...</div>}

                {/* Upload + Meta */}
                <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",marginBottom:16}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                      <span style={{fontSize:15,fontWeight:700,color:"#1a1a2e"}}>📦 {activeBlNo}</span>
                      <select value={jobMeta.status} onChange={e=>saveMeta({status:e.target.value})}
                        style={{padding:"3px 8px",borderRadius:20,border:"none",fontSize:12,fontWeight:700,
                          color:currentStatus.color,background:currentStatus.bg,cursor:"pointer",outline:"none"}}>
                        {STATUSES.filter(s=>s.key!=="all").map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                    </div>
                    <button onClick={()=>{setFiles([]);setUnified({});setError("");setJobMeta({status:"ongoing",memo:"",manager:""}); }}
                      style={{fontSize:12,padding:"5px 12px",borderRadius:6,border:"1px solid #eee",background:"white",cursor:"pointer",color:"#888"}}>초기화</button>
                  </div>

                  <div style={{display:"flex",gap:10,marginBottom:14}}>
                    <input value={jobMeta.manager} onChange={e=>setJobMeta(p=>({...p,manager:e.target.value}))}
                      onBlur={()=>saveMeta({})} placeholder="담당자"
                      style={{width:120,padding:"7px 10px",border:"1px solid #e0e0e0",borderRadius:8,fontSize:13,outline:"none"}}/>
                    <input value={jobMeta.memo} onChange={e=>setJobMeta(p=>({...p,memo:e.target.value}))}
                      onBlur={()=>saveMeta({})} placeholder="메모 (특이사항, 고객 요청 등)"
                      style={{flex:1,padding:"7px 10px",border:"1px solid #e0e0e0",borderRadius:8,fontSize:13,outline:"none"}}/>
                  </div>

                  <div onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={onDrop} onClick={()=>fileRef.current.click()}
                    style={{border:`2px dashed ${dragging?"#1a1a2e":"#d0d0d0"}`,borderRadius:12,padding:"22px 20px",textAlign:"center",cursor:"pointer",background:dragging?"#f0f0ff":"#fafafa",marginBottom:12}}>
                    <div style={{fontSize:28,marginBottom:5}}>📂</div>
                    <div style={{fontSize:14,color:"#555",fontWeight:600}}>MBL · HBL · CI · PL · 수출면장 · Booking Sheet</div>
                    <div style={{fontSize:12,color:"#aaa",marginTop:3}}>PDF · JPG · PNG · XLSX · TXT · CSV — 여러 파일 한번에</div>
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

                  <button onClick={extractAll} disabled={loading||!files.length}
                    style={{width:"100%",padding:"12px 0",background:loading||!files.length?"#ccc":"#1a1a2e",color:"white",border:"none",borderRadius:10,fontSize:15,fontWeight:700,cursor:loading||!files.length?"not-allowed":"pointer",marginTop:4}}>
                    {loading?"⏳ 추출 중...":Object.keys(unified).length>0?"🔍 추가 파일 추출 (누적)":"🔍 추출하기"}
                  </button>
                </div>

                {/* Result */}
                {Object.keys(unified).length>0&&(
                  <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
                      <div style={{fontSize:15,fontWeight:700,color:"#1a1a2e"}}>📋 통합 추출 결과</div>
                      <div style={{display:"flex",gap:8}}>
                        <button onClick={()=>setShowTemplate(true)}
                          style={{padding:"7px 14px",borderRadius:8,border:"1px solid #ddd",background:"white",color:"#555",fontSize:12,cursor:"pointer",fontWeight:600}}>📋 ERP 템플릿</button>
                        <button onClick={exportExcel}
                          style={{padding:"7px 14px",borderRadius:8,border:"none",background:"#2e7d32",color:"white",fontSize:12,cursor:"pointer",fontWeight:600}}>📊 엑셀</button>
                        <button onClick={()=>setShowExport(true)}
                          style={{padding:"7px 14px",borderRadius:8,border:"1px solid #ddd",background:"white",color:"#555",fontSize:12,cursor:"pointer",fontWeight:600}}>📑 내보내기</button>
                      </div>
                    </div>
                    {SECTIONS.map(sec=>(
                      <div key={sec.title} style={{marginBottom:24}}>
                        <div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:10,paddingBottom:6,borderBottom:"1px solid #f0f0f0"}}>{sec.title}</div>
                        {sec.fields.map(f=><FieldRow key={f.key} fieldKey={f.key} label={f.label}/>)}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ERP Template Modal */}
        {showTemplate&&(
          <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
            onClick={e=>e.target===e.currentTarget&&setShowTemplate(false)}>
            <div style={{background:"white",borderRadius:14,padding:24,maxWidth:660,width:"100%",maxHeight:"85vh",display:"flex",flexDirection:"column"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <span style={{fontWeight:700,fontSize:15}}>📋 유한ERP (글로벌원) 입력 템플릿</span>
                <button onClick={()=>setShowTemplate(false)} style={{border:"none",background:"none",fontSize:22,cursor:"pointer",color:"#aaa"}}>✕</button>
              </div>
              <textarea readOnly value={erpTemplate} style={{flex:1,minHeight:400,fontFamily:"monospace",fontSize:12,border:"1px solid #eee",borderRadius:8,padding:12,resize:"none",outline:"none",margin:"0 0 12px"}}/>
              <button onClick={()=>navigator.clipboard.writeText(erpTemplate)}
                style={{padding:"11px 0",background:"#1a1a2e",color:"white",border:"none",borderRadius:9,fontSize:14,fontWeight:700,cursor:"pointer"}}>📋 전체 복사</button>
            </div>
          </div>
        )}

        {/* Export Modal */}
        {showExport&&(
          <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
            onClick={e=>e.target===e.currentTarget&&setShowExport(false)}>
            <div style={{background:"white",borderRadius:14,padding:24,maxWidth:660,width:"100%",maxHeight:"82vh",display:"flex",flexDirection:"column"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <span style={{fontWeight:700,fontSize:15}}>📋 {activeBlNo} 전체 내용</span>
                <button onClick={()=>setShowExport(false)} style={{border:"none",background:"none",fontSize:22,cursor:"pointer",color:"#aaa"}}>✕</button>
              </div>
              <textarea readOnly value={exportText} style={{flex:1,minHeight:360,fontFamily:"monospace",fontSize:11,border:"1px solid #eee",borderRadius:8,padding:12,resize:"none",outline:"none",margin:"12px 0"}}/>
              <button onClick={()=>navigator.clipboard.writeText(exportText)}
                style={{padding:"11px 0",background:"#1a1a2e",color:"white",border:"none",borderRadius:9,fontSize:14,fontWeight:700,cursor:"pointer"}}>📑 전체 복사</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
