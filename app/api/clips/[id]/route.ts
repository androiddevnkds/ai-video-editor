import { get } from "@vercel/blob";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!authorization?.startsWith("Bearer ") || !url || !key) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const client = createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData } = await client.auth.getUser(authorization.slice(7));
  if (!userData.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const { data: clip, error } = await client.from("clips").select("id, output_url, title").eq("id", id).single();
  if (error || !clip?.output_url) return NextResponse.json({ error: "Klip tidak ditemukan" }, { status: 404 });
  const blob = await get(clip.output_url, { access: "private" });
  if (!blob || blob.statusCode !== 200) return NextResponse.json({ error: "File klip tidak ditemukan" }, { status: 404 });
  const download = request.nextUrl.searchParams.get("download") === "1";
  const filename = `${String(clip.title || "ai-highlight").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}.mp4`;
  return new NextResponse(blob.stream, { headers: { "Content-Type": blob.blob.contentType, "Content-Length": String(blob.blob.size), "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`, "Cache-Control": "private, max-age=0, must-revalidate" } });
}
