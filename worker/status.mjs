import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await supabase.from("processing_jobs").select("status, progress, stage_message, error_message").order("created_at", { ascending: false }).limit(1).single();
if (error) throw error;
console.log(JSON.stringify(data));
