import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import pg from 'pg';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('Thiếu DATABASE_URL. Xem file .env.example'); process.exit(1); }
const pool = new pg.Pool({connectionString:DB, ssl: /sslmode=require/.test(DB) ? {rejectUnauthorized:true} : undefined});
const STAFF = (process.env.STAFF_NAMES || 'Thợ 1,Thợ 2,Thợ 3,Thợ 4').split(',').map(x=>x.trim()).filter(Boolean).slice(0,30);
const TIMEZONE = process.env.SHOP_TIMEZONE || 'America/Los_Angeles';
const SHOP = process.env.SHOP_NAME || 'Nail Salon';
const SERVICES = [
  {id:'manicure',name:'Manicure',minutes:30},
  {id:'fill',name:'Fill',minutes:60},
  {id:'fullset',name:'Full Set',minutes:90},
  {id:'pedicure',name:'Pedicure',minutes:45},
  {id:'fullsettoe',name:'Full Set Toe',minutes:45},
  {id:'colorchange',name:'Color Change',minutes:20}
];
const OPEN=9*60, CLOSE=18*60;
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'",'data:'],connectSrc:["'self'"],objectSrc:["'none'"],upgradeInsecureRequests:null}}}));
app.use(express.json({limit:'20kb'}));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)),'public')));

async function init(){
 await pool.query(`CREATE TABLE IF NOT EXISTS appointments (
   id BIGSERIAL PRIMARY KEY,
   customer_name VARCHAR(100) NOT NULL,
   phone VARCHAR(30) NOT NULL,
   staff VARCHAR(100) NOT NULL,
   booking_date DATE NOT NULL,
   start_min INTEGER NOT NULL,
   end_min INTEGER NOT NULL,
   services JSONB NOT NULL,
   status VARCHAR(20) NOT NULL DEFAULT 'booked' CHECK(status IN ('booked','cancelled')),
   notification_status VARCHAR(20) NOT NULL DEFAULT 'not_sent',
   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 )`);
 await pool.query('CREATE INDEX IF NOT EXISTS appt_staff_date ON appointments (staff,booking_date,start_min,end_min)');
}
function dayLocal(){ const parts = new Intl.DateTimeFormat('en-US',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()); const val=t=>parts.find(p=>p.type===t).value; return `${val('year')}-${val('month')}-${val('day')}`; }
function validDay(v){ if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; const d=new Date(v+'T12:00:00Z'); if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==v)return false; const today=dayLocal(); const max=new Date(today+'T12:00:00Z'); max.setUTCDate(max.getUTCDate()+60); return v>=today && v<=max.toISOString().slice(0,10); }
function timeStr(min){return `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`;}
function parseServices(v){if(!Array.isArray(v)||v.length<1||v.length>6||new Set(v).size!==v.length)return null; if(v.some(x=>!SERVICES.some(s=>s.id===x)))return null; if((v.includes('fullsettoe')||v.includes('colorchange'))&&!v.includes('pedicure'))return null; return v.map(x=>SERVICES.find(s=>s.id===x));}
function duration(s){return Math.ceil(s.reduce((n,x)=>n+x.minutes,0)/30)*30;}
function slowDown(){const counts=new Map();return (req,res,next)=>{const k=req.ip;const now=Date.now();const v=counts.get(k)||{n:0,t:now};if(now-v.t>60000){v.n=0;v.t=now;}v.n++;counts.set(k,v);if(counts.size>10000)counts.clear();if(v.n>45)return res.status(429).json({error:'Quá nhiều yêu cầu. Vui lòng thử lại sau.'});next();};}
app.use('/api',slowDown());
function auth(req,res,next){const expected=process.env.ADMIN_PASSWORD;if(!expected||expected.length<16)return res.status(503).json({error:'Chưa cấu hình ADMIN_PASSWORD tối thiểu 16 ký tự.'});const header=req.get('authorization')||'';let password='';if(header.startsWith('Basic ')){try{const value=Buffer.from(header.slice(6),'base64').toString();password=value.slice(value.indexOf(':')+1);}catch{}}const a=Buffer.from(password),b=Buffer.from(expected);if(a.length!==b.length||!timingSafeEqual(a,b))return res.status(401).json({error:'Sai mật khẩu quản lý.'});next();}

app.get('/api/config',(req,res)=>res.json({shop:SHOP,staff:STAFF,services:SERVICES,timezone:TIMEZONE,open:timeStr(OPEN),close:timeStr(CLOSE),today:dayLocal()}));
app.get('/api/availability',async(req,res)=>{try{
 const date=req.query.date, services=parseServices(String(req.query.services||'').split(',')), requested=req.query.staff;
 if(!validDay(date)||!services||!STAFF.includes(requested))return res.status(400).json({error:'Ngày, thợ hoặc dịch vụ không hợp lệ.'});
 const dur=duration(services);
 const {rows}=await pool.query("SELECT staff,start_min,end_min FROM appointments WHERE booking_date=$1 AND status='booked'",[date]);
 const slots=[];
 for(let t=OPEN;t+dur<=CLOSE;t+=30){if(date===dayLocal()){
   const fmt=new Intl.DateTimeFormat('en-US',{timeZone:TIMEZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());const [h,m]=fmt.split(':').map(Number);if(t<=h*60+m)continue;
 }const free=rows.every(x=>x.staff!==requested||t+dur<=x.start_min||t>=x.end_min);if(free)slots.push(timeStr(t));}
 res.json({slots,duration:dur});
 }catch(e){console.error(e);res.status(500).json({error:'Không tải được giờ trống.'});}});

async function emailNotify(b){const key=process.env.RESEND_API_KEY;const to=process.env.SHOP_EMAIL;const from=process.env.MAIL_FROM;if(!key||!to||!from)return 'not_configured';
 const html=`<h2>Lịch nail mới #${b.id}</h2><p><b>Khách:</b> ${escapeHTML(b.name)}</p><p><b>Điện thoại:</b> ${escapeHTML(b.phone)}</p><p><b>Thợ:</b> ${escapeHTML(b.staff)}</p><p><b>Ngày:</b> ${escapeHTML(b.date)}</p><p><b>Giờ:</b> ${escapeHTML(b.time)}</p><p><b>Dịch vụ:</b> ${b.services.map(x=>escapeHTML(x)).join(', ')}</p><p>Đăng nhập trang /admin.html để xem lịch.</p>`;
 try {const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[to],subject:`Lịch nail mới #${b.id} - ${b.date} ${b.time}`,html}),signal:AbortSignal.timeout(8000)});if(!r.ok){console.error('Resend:',r.status,await r.text());return 'failed';}return 'sent';}catch(e){console.error('Email error:',e.message);return 'failed';}
}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
app.post('/api/bookings',async(req,res)=>{
 const {name,phone,staff,date,time,services:ids}=req.body||{};
 const selected=parseServices(ids);
 if(typeof name!=='string'||name.trim().length<2||name.length>100||typeof phone!=='string'||!/^[+()0-9 .-]{7,25}$/.test(phone.trim())||!STAFF.includes(staff)||!validDay(date)||!selected||typeof time!=='string'||!/^\d\d:\d\d$/.test(time))return res.status(400).json({error:'Vui lòng kiểm tra thông tin đặt lịch.'});
 const [h,m]=time.split(':').map(Number);const start=h*60+m,end=start+duration(selected);
 if(m%30!==0||start<OPEN||end>CLOSE)return res.status(400).json({error:'Giờ hoặc thời lượng không hợp lệ.'});
 if(date===dayLocal()){const cur=new Intl.DateTimeFormat('en-US',{timeZone:TIMEZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());const [ch,cm]=cur.split(':').map(Number);if(start<=ch*60+cm)return res.status(400).json({error:'Giờ đã qua.'});}
 let client;
 try{
 client=await pool.connect();await client.query('BEGIN');
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[staff+'|'+date]);
 const {rows:busy}=await client.query("SELECT id FROM appointments WHERE staff=$1 AND booking_date=$2 AND status='booked' AND start_min<$4 AND end_min>$3 LIMIT 1",[staff,date,start,end]);
 if(busy.length){await client.query('ROLLBACK');return res.status(409).json({error:'Giờ này vừa có khách đặt. Vui lòng chọn giờ khác.'});}
 const q=await client.query("INSERT INTO appointments(customer_name,phone,staff,booking_date,start_min,end_min,services) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id",[name.trim(),phone.trim(),staff,date,start,end,JSON.stringify(selected.map(x=>x.name))]);
 await client.query('COMMIT');const id=q.rows[0].id;
 res.status(201).json({id,name:name.trim(),staff,date,time,services:selected.map(s=>s.name),message:'Đã nhận lịch hẹn.'});
 // Gửi email sau khi dữ liệu đã lưu; thất bại không làm mất lịch.
 const status=await emailNotify({id,name:name.trim(),phone:phone.trim(),staff,date,time,services:selected.map(s=>s.name)});
 await pool.query('UPDATE appointments SET notification_status=$1 WHERE id=$2',[status,id]).catch(console.error);
 }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});console.error(e);if(!res.headersSent)res.status(500).json({error:'Lỗi máy chủ. Vui lòng thử lại.'});}finally{client?.release();}
});
app.get('/api/admin/bookings',auth,async(req,res)=>{try{
 const date=typeof req.query.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(req.query.date)?req.query.date:dayLocal();
 const {rows}=await pool.query("SELECT id,customer_name,phone,staff,booking_date::text AS date,start_min,end_min,services,status,notification_status,created_at FROM appointments WHERE booking_date=$1 ORDER BY start_min,staff",[date]);
 res.set('Cache-Control','no-store').json({date,rows:rows.map(x=>({...x,time:timeStr(x.start_min),endTime:timeStr(x.end_min)}))});
 }catch(e){console.error(e);res.status(500).json({error:'Không tải được lịch.'});}});
app.patch('/api/admin/bookings/:id',auth,async(req,res)=>{
 if(!['cancelled','booked'].includes(req.body?.status)||!/^[0-9]+$/.test(req.params.id))return res.status(400).json({error:'Yêu cầu không hợp lệ.'});
 let client;
 try{
 client=await pool.connect();await client.query('BEGIN');
 const found=await client.query('SELECT staff,booking_date::text AS date,start_min,end_min FROM appointments WHERE id=$1',[req.params.id]);
 if(!found.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Không tìm thấy lịch.'});}
 const b=found.rows[0];
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[b.staff+'|'+b.date]);
 if(req.body.status==='booked'){
   const clash=await client.query("SELECT id FROM appointments WHERE staff=$1 AND booking_date=$2 AND status='booked' AND id<>$5 AND start_min<$4 AND end_min>$3 LIMIT 1",[b.staff,b.date,b.start_min,b.end_min,req.params.id]);
   if(clash.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'Không thể khôi phục vì đã có lịch khác trùng giờ.'});}
 }
 const result=await client.query('UPDATE appointments SET status=$1 WHERE id=$2 RETURNING id,status',[req.body.status,req.params.id]);
 await client.query('COMMIT');res.json(result.rows[0]);
 }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});console.error(e);res.status(500).json({error:'Không cập nhật được.'});}finally{client?.release();}
});

init().then(()=>app.listen(PORT,()=>console.log(`Nail booking running on port ${PORT}`))).catch(e=>{console.error('DB init failed:',e);process.exit(1);});
