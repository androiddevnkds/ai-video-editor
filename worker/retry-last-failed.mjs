import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: job, error } = await supabase.from("processing_jobs").select("id, video_id").eq("status", "failed").order("created_at", { ascending: false }).limit(1).maybeSingle();
if (error) throw error;
if (!job) {
  console.log("No failed job found.");
  process.exit(0);
}
const { error: jobError } = await supabase.from("processing_jobs").update({ status: "queued", progress: 0, stage_message: "Menunggu worker", error_message: null, started_at: null, completed_at: null }).eq("id", job.id);
if (jobError) throw jobError;
const { error: videoError } = await supabase.from("videos").update({ status: "queued", progress: 0, error_message: null }).eq("id", job.video_id);
if (videoError) throw videoError;
console.log("Latest failed job returned to queue.");
