import { env } from "@/lib/platform";
import { NextResponse } from "next/server";
import { getAdminSession, hasAdminSession, isFullAdmin } from "../admin/session";

export async function GET(){
 const session=await getAdminSession();if(!session)return NextResponse.json({error:"Sign in required."},{status:401});
 const full=isFullAdmin(session);const manageAttendance=full||session.permissions.includes("attendance_manage");const manageSchedule=full||session.permissions.includes("schedule_manage");
 const canAttendance=full||session.permissions.includes("attendance");const canSchedule=full||session.permissions.includes("schedule");
 const attendance=canAttendance?await env.DB!.prepare(`SELECT * FROM attendance ${manageAttendance?"":"WHERE username=?"} ORDER BY clock_in DESC LIMIT 250`).bind(...(manageAttendance?[]:[session.username])).all():{results:[]};
 const schedules=canSchedule?await env.DB!.prepare(`SELECT * FROM schedules ${manageSchedule?"":"WHERE username=?"} ORDER BY shift_date,start_time LIMIT 250`).bind(...(manageSchedule?[]:[session.username])).all():{results:[]};
 const staff=manageSchedule?await env.DB!.prepare("SELECT username,role,active FROM staff WHERE active=1 ORDER BY username").all():{results:[]};
 return NextResponse.json({attendance:attendance.results,schedules:schedules.results,staff:staff.results,manageAttendance,manageSchedule,canAttendance,canSchedule});
}
export async function POST(request:Request){
 const session=await getAdminSession();if(!session)return NextResponse.json({error:"Sign in required."},{status:401});
 const body=await request.json().catch(()=>null);if(!body)return NextResponse.json({error:"Invalid request."},{status:400});const db=env.DB!;
 if(body.action==="clock-in"){
  if(!await hasAdminSession("attendance"))return NextResponse.json({error:"Attendance access is not enabled for this account."},{status:403});
  const active=await db.prepare("SELECT id FROM attendance WHERE username=? AND clock_out IS NULL LIMIT 1").bind(session.username).first();if(active)return NextResponse.json({error:"You already have an open shift. Clock out before starting another."},{status:409});
  try{await db.prepare("INSERT INTO attendance (id,username,clock_in,clock_out) VALUES (?,?,?,NULL)").bind(crypto.randomUUID(),session.username,new Date().toISOString()).run()}catch{return NextResponse.json({error:"An active shift is already open for this account."},{status:409})}
 }
 if(body.action==="clock-out"){
  if(!await hasAdminSession("attendance"))return NextResponse.json({error:"Attendance access is not enabled for this account."},{status:403});
  const active=await db.prepare("SELECT id FROM attendance WHERE username=? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1").bind(session.username).first<any>();if(!active)return NextResponse.json({error:"There is no open shift to clock out."},{status:409});
  await db.prepare("UPDATE attendance SET clock_out=? WHERE id=? AND clock_out IS NULL").bind(new Date().toISOString(),active.id).run();
 }
 if(body.action==="schedule"){
  if(!await hasAdminSession("schedule_manage"))return NextResponse.json({error:"Schedule management is not enabled for this account."},{status:403});
  const username=String(body.username||"").toLowerCase(),date=String(body.date||""),start=String(body.start||""),end=String(body.end||""),note=String(body.note||"").slice(0,140);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||end<=start)return NextResponse.json({error:"Choose a valid date and end time later than the start."},{status:400});
  const person=await db.prepare("SELECT username FROM staff WHERE username=? AND active=1").bind(username).first();if(!person)return NextResponse.json({error:"Choose an active staff account."},{status:400});
  const existing=await db.prepare("SELECT id,start_time,end_time FROM schedules WHERE username=? AND shift_date=?").bind(username,date).all<any>();if(existing.results.some((s:any)=>start<s.end_time&&end>s.start_time))return NextResponse.json({error:"That time overlaps another planned shift."},{status:409});
  await db.prepare("INSERT INTO schedules (id,username,shift_date,start_time,end_time,note) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),username,date,start,end,note).run();
 }
 if(body.action==="delete-schedule"){
  if(!await hasAdminSession("schedule_manage"))return NextResponse.json({error:"Schedule management is not enabled for this account."},{status:403});
  await db.prepare("DELETE FROM schedules WHERE id=?").bind(String(body.id)).run();
 }
 return NextResponse.json({ok:true});
}
