# Clipflow — AI Video Editor

MVP dashboard untuk mengunggah video mentah sebelum diproses menjadi klip pendek oleh AI.

## Menjalankan secara lokal

1. Install dependency: `npm install`
2. Salin `.env.example` menjadi `.env.local`
3. Isi kredensial publishable Supabase dan `BLOB_READ_WRITE_TOKEN`
4. Jalankan: `npm run dev`

## Deploy ke Vercel

Import repository ini di Vercel, buat Blob Store, hubungkan store ke project, lalu deploy ulang. Vercel akan menyediakan `BLOB_READ_WRITE_TOKEN` secara otomatis.

Video diunggah langsung dari browser ke Vercel Blob menggunakan multipart upload. Batas aplikasi saat ini adalah 2 GB per file.

## Database

Migration awal ada di `supabase/migrations`. Terapkan melalui Supabase CLI (`supabase db push`) atau tempel isinya ke SQL Editor Supabase. Migration membuat tabel `profiles`, `videos`, dan `clips` beserta Row Level Security.
