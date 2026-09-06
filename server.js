import "dotenv/config";
import express from "express";
import multer from "multer";
import OpenAI from "openai";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = process.cwd();
const DATA = path.join(ROOT, "data");
const UP = path.join(DATA, "uploads");
const OUT = path.join(DATA, "outputs");
for (const d of [DATA, UP, OUT]) fs.mkdirSync(d, {recursive:true});

const upload = multer({
  dest: UP,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 500) * 1024 * 1024 }
});

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use("/outputs", express.static(OUT));

function run(cmd,args){
  return new Promise((resolve,reject)=>{
    const p=spawn(cmd,args);
    let err="";
    p.stderr.on("data",d=>err+=d.toString());
    p.on("close",code=>code===0?resolve():reject(new Error(err.slice(-4000))));
  });
}
function ffprobe(file){
  return new Promise((resolve,reject)=>{
    const p=spawn("ffprobe",["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",file]);
    let out="",err="";
    p.stdout.on("data",d=>out+=d.toString()); p.stderr.on("data",d=>err+=d.toString());
    p.on("close",c=>c===0?resolve(Number(out.trim())):reject(new Error(err)));
  });
}
async function frames(file, id){
  const dir=path.join(DATA,"frames-"+id); fs.mkdirSync(dir,{recursive:true});
  const duration=Math.max(1,await ffprobe(file));
  const count=Math.min(12, Math.max(4, Math.floor(duration/8)));
  for(let i=0;i<count;i++){
    const t=(duration*(i+0.5))/count;
    await run("ffmpeg",["-y","-ss",String(t),"-i",file,"-frames:v","1","-vf","scale=640:-1",path.join(dir,`${i}.jpg`)]);
  }
  return fs.readdirSync(dir).filter(x=>x.endsWith(".jpg")).sort().map(x=>path.join(dir,x));
}
async function makeScript(frameFiles, targetSeconds){
  const content=[{type:"input_text",text:
`You are a movie recap writer. Create a concise Myanmar-language TikTok recap narration based ONLY on the supplied frames. Target spoken length: ${targetSeconds} seconds. Do not invent names/events that are not reasonably visible. Make it exciting and easy to narrate. Return ONLY the Myanmar narration, no title, no bullets.`}];
  for(const f of frameFiles){
    content.push({type:"input_image",image_url:"data:image/jpeg;base64,"+fs.readFileSync(f).toString("base64"),detail:"low"});
  }
  const r=await client.responses.create({model:"gpt-5.6-luna",input:[{role:"user",content}]});
  return r.output_text.trim();
}
async function tts(text,out){
  const speech=await client.audio.speech.create({
    model:"gpt-4o-mini-tts", voice:"marin", input:text,
    instructions:"Speak naturally in Burmese (Myanmar language), energetic movie-recap narrator style.",
    response_format:"mp3"
  });
  fs.writeFileSync(out,Buffer.from(await speech.arrayBuffer()));
}
function srtFromText(text,duration){
  const parts=text.split(/(?<=[။!?])\s+/).filter(Boolean);
  const weights=parts.map(x=>Math.max(1,x.length)); const total=weights.reduce((a,b)=>a+b,0);
  let cur=0,s="";
  for(let i=0;i<parts.length;i++){
    const len=duration*weights[i]/total, a=cur,b=Math.min(duration,cur+len); cur=b;
    const fmt=t=>{let ms=Math.round((t%1)*1000), sec=Math.floor(t)%60,min=Math.floor(t/60)%60,hr=Math.floor(t/3600);return `${String(hr).padStart(2,"0")}:${String(min).padStart(2,"0")}:${String(sec).padStart(2,"0")},${String(ms).padStart(3,"0")}`};
    s+=`${i+1}\n${fmt(a)} --> ${fmt(b)}\n${parts[i]}\n\n`;
  }
  return s;
}
async function render(video,voice,target,id){
  const out=path.join(OUT,id+".mp4");
  const srt=path.join(OUT,id+".srt");
  const dur=Math.min(target,await ffprobe(video),await ffprobe(voice));
  const text=global.__scripts[id]||"";
  fs.writeFileSync(srt,srtFromText(text,dur),"utf8");
  // Preserve the supplied clip's content, fit to vertical 9:16, replace audio with narration.
  await run("ffmpeg",["-y","-i",video,"-i",voice,
    "-t",String(dur),
    "-filter_complex","[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1[v];[1:a]apad,atrim=0:"+dur+"[a]",
    "-map","[v]","-map","[a]","-c:v","libx264","-preset","veryfast","-crf","23",
    "-c:a","aac","-b:a","128k","-shortest",out]);
  return out;
}
global.__scripts={};

app.get("/", (req,res)=>res.type("html").send(`<!doctype html>
<html lang="my">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Movie Recap AI 🇲🇲</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#090a0f;color:#f7f7f7;font-family:Arial,"Noto Sans Myanmar",sans-serif}
main{max-width:720px;margin:auto;padding:22px}.hero{text-align:center;padding:22px 0 10px}h1{font-size:34px;margin:8px 0}.muted{color:#9b9ba5;line-height:1.6}.card{background:#14151c;border:1px solid #292b36;border-radius:20px;padding:20px;margin:15px 0}
.drop{border:2px dashed #555;border-radius:16px;text-align:center;padding:34px 12px;cursor:pointer}.drop b{font-size:18px}.icon{font-size:44px}
.row{display:flex;gap:10px;margin-top:14px}.row>*{flex:1}select,button{border:0;border-radius:13px;padding:15px;font-size:16px}select{background:#252732;color:white;border:1px solid #3a3d49}
button{background:white;color:#111;font-weight:800;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}
#status{display:none}.bar{height:10px;background:#292b36;border-radius:10px;overflow:hidden}.fill{width:0;height:100%;background:white;transition:.4s}.step{padding:8px 0;color:#888}.step.on{color:#fff}.result{display:none}textarea{width:100%;min-height:220px;background:#0d0e13;color:#fff;border:1px solid #333;border-radius:12px;padding:14px;line-height:1.7}
a.download{display:block;text-align:center;background:white;color:#111;text-decoration:none;font-weight:800;padding:15px;border-radius:13px;margin-top:12px}.warn{font-size:12px;color:#888}
</style></head>
<body><main>
<div class="hero"><div>🎬 MOVIE RECAP AI 🇲🇲</div><h1>One Click Recap</h1><p class="muted">Clip တင် → မြန်မာ Recap Voice + 9:16 MP4</p></div>
<div class="card">
  <div class="drop" id="drop"><div class="icon">🎞️</div><b>Movie Clip ရွေးပါ</b><p class="muted">MP4 / MOV / WebM • သင့်မှာအသုံးပြုခွင့်ရှိတဲ့ footage ကိုသာတင်ပါ</p><div id="fn"></div><input id="file" type="file" accept="video/*" hidden></div>
  <div class="row"><select id="duration"><option value="60">60 seconds</option><option value="90">90 seconds</option><option value="120">120 seconds</option></select><button id="go" disabled>⚡ ONE CLICK</button></div>
</div>
<div class="card" id="status"><b id="st">Processing…</b><div class="bar"><div class="fill" id="fill"></div></div>
<div class="step" id="s1">○ Analyze frames</div><div class="step" id="s2">○ Write Myanmar recap</div><div class="step" id="s3">○ Generate Myanmar voice</div><div class="step" id="s4">○ Render 9:16 MP4</div></div>
<div class="card result" id="result"><b>✅ Ready</b><p class="muted">Script ကိုလိုအပ်ရင် copy ယူပြီး CapCut မှာ ထပ်ပြင်နိုင်ပါတယ်။</p><textarea id="script"></textarea><a id="video" class="download" target="_blank">🎬 Open / Save MP4</a><a id="audio" class="download" target="_blank">🔊 Open Voice MP3</a></div>
<p class="warn">Copyright notice: ဒီ app က copyright ကိုဖျောက်ပေးတဲ့ tool မဟုတ်ပါ။ Upload လုပ်တဲ့ footage ကိုအသုံးပြုခွင့်ရှိမရှိ သင်ကိုယ်တိုင်သေချာစစ်ပါ။</p>
</main>
<script>
const $=id=>document.getElementById(id), file=$("file"),drop=$("drop"),go=$("go");
drop.onclick=()=>file.click(); file.onchange=()=>{if(file.files[0]){$("fn").textContent="📁 "+file.files[0].name;go.disabled=false}};
function step(n){$("s"+n).classList.add("on");$("s"+n).textContent="✓ "+$("s"+n).textContent.slice(2)}
go.onclick=async()=>{
 go.disabled=true;$("status").style.display="block";$("result").style.display="none";
 $("fill").style.width="15%";step(1);
 const fd=new FormData();fd.append("video",file.files[0]);fd.append("duration",$("duration").value);
 try{
  $("fill").style.width="30%";step(2);
  const r=await fetch("/api/generate",{method:"POST",body:fd}); const data=await r.json();
  if(!r.ok)throw new Error(data.error||"Failed");
  $("fill").style.width="75%";step(3);$("fill").style.width="100%";step(4);
  $("script").value=data.script;$("video").href=data.video;$("audio").href=data.audio;$("result").style.display="block";$("st").textContent="Finished 🎉";
 }catch(e){alert(e.message);$("st").textContent="Error";}finally{go.disabled=false}
};
</script></body></html>`));

app.post("/api/generate", upload.single("video"), async (req,res)=>{
  let file=req.file?.path;
  try{
    if(!file) return res.status(400).json({error:"Video file is required."});
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({error:"OPENAI_API_KEY is not configured."});
    const target=Number(req.body.duration||60);
    if(![60,90,120].includes(target)) return res.status(400).json({error:"Duration must be 60, 90 or 120 seconds."});
    const id=crypto.randomUUID();
    const fs0=await ffprobe(file);
    const frameFiles=await frames(file,id);
    const script=await makeScript(frameFiles,target);
    global.__scripts[id]=script;
    const voice=path.join(OUT,id+".mp3");
    await tts(script,voice);
    const video=await render(file,voice,target,id);
    res.json({ok:true,id,script,video:"/outputs/"+path.basename(video),audio:"/outputs/"+path.basename(voice)});
  }catch(e){
    res.status(500).json({error:e.message||"Generation failed."});
  }finally{
    // Keep output; remove uploaded temp file.
    try{if(file) fs.unlinkSync(file)}catch{}
  }
});
app.listen(PORT,()=>console.log(`Movie Recap AI running at http://localhost:${PORT}`));
