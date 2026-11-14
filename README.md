# Clipflow — AI Video Editor

MVP dashboard untuk mengunggah video mentah sebelum diproses menjadi klip pendek oleh AI.

## Menjalankan secara lokal

1. Install dependency: `npm install`
2. Salin `.env.example` menjadi `.env.local`
3. Isi kredensial publishable Supabase dan `BLOB_READ_WRITE_TOKEN`
4. Jalankan: `npm run dev`

## Deploy ke Vercel

Import repository ini di Vercel, buat Blob Store, hubungkan store ke project, lalu deploy ulang. Vercel akan menyediakan `BLOB_READ_WRITE_TOKEN` secara otomatis.

Video diunggah langsung dari browser ke private Vercel Blob menggunakan multipart upload. Batas aplikasi saat ini adalah 2 GB per file.

## Database

Migration awal ada di `supabase/migrations`. Terapkan melalui Supabase CLI (`supabase db push`) atau tempel isinya ke SQL Editor Supabase. Migration membuat tabel `profiles`, `videos`, dan `clips` beserta Row Level Security.

## AI processing worker

Worker lokal mengambil job dari `processing_jobs`, mengunduh private Blob, mengekstrak audio dengan FFmpeg, membuat transcript melalui OpenAI, memilih highlight, memotong video, dan mengunggah klip hasilnya.

Prasyarat:

- Node.js 20+
- FFmpeg dan FFprobe tersedia pada `PATH`
- OpenAI API key dengan billing API aktif

Setup:

1. Salin `.env.worker.example` menjadi `.env.worker.local`.
2. Isi Supabase service-role key, Vercel Blob read-write token, dan OpenAI API key. Jangan commit file ini.
3. Jalankan `npm run worker`.
4. Biarkan terminal worker tetap terbuka selama ingin memproses antrean.

Model transkripsi default adalah `gpt-transcribe`. Model penilai highlight dapat diganti melalui `OPENAI_HIGHLIGHT_MODEL`.
