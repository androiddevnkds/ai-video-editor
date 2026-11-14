import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!clientPayload) throw new Error("Unauthorized");
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
        if (!url || !key) throw new Error("Supabase is not configured");
        const client = createClient(url, key, { auth: { persistSession: false } });
        const { data, error } = await client.auth.getUser(clientPayload);
        if (error || !data.user) throw new Error("Unauthorized");

        return {
          allowedContentTypes: [
            "video/mp4",
            "video/quicktime",
            "video/webm",
            "video/x-matroska",
          ],
          maximumSizeInBytes: MAX_VIDEO_SIZE,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ pathname, userId: data.user.id, uploadedAt: Date.now() }),
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.info("Video uploaded:", blob.pathname);
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload gagal.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
