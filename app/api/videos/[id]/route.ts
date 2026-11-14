import { del, get } from "@vercel/blob";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function authenticatedClient(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ownedVideo(request: NextRequest, id: string) {
  const client = authenticatedClient(request);
  if (!client) return { error: "Unauthorized", status: 401 } as const;

  const token = request.headers.get("authorization")!.slice(7);
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return { error: "Unauthorized", status: 401 } as const;

  const { data, error } = await client
    .from("videos")
    .select("id, pathname, filename, content_type")
    .eq("id", id)
    .single();

  if (error || !data) return { error: "Video tidak ditemukan", status: 404 } as const;
  return { client, video: data } as const;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await ownedVideo(request, id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  const blob = await get(result.video.pathname, { access: "private" });
  if (!blob || blob.statusCode !== 200) return NextResponse.json({ error: "File tidak ditemukan" }, { status: 404 });

  const download = request.nextUrl.searchParams.get("download") === "1";
  return new NextResponse(blob.stream, {
    headers: {
      "Content-Type": blob.blob.contentType || result.video.content_type,
      "Content-Length": String(blob.blob.size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(result.video.filename)}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
      ETag: blob.blob.etag,
    },
  });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await ownedVideo(request, id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  await del(result.video.pathname);
  const { error } = await result.client.from("videos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ success: true });
}
