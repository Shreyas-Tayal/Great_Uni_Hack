# Paste this as your first Lovable prompt

Build a single-page React + TypeScript + Tailwind app called **Foresight**: an AI accountant for
individuals and small businesses. Use recharts for charts and lucide-react for icons. No auth, no Supabase.

Layout (desktop): a top bar with the name "Foresight", a Personal/Business segmented toggle and an
account dropdown. Below, two columns: left (about 40%) is a full-height chat panel; right (about 60%)
is a "canvas" with a big headline number, a forecast chart, alert cards and an upcoming-payments list.
On mobile, stack chat above canvas.

Style: light, calm and precise. Page background #f4f3f8, white surfaces with 1px #e3e0ec borders and
14px radius, ink #1c1530, secondary text #5d5875, primary violet #5b2bd9, risk red #cf3048 (only for
below-zero risk), improvement green #0f8065. Font: Onest (Google Fonts) with tabular numbers.
No gradients, no drop shadows, no emoji.

Leave the page at src/pages/Index.tsx simple: I will replace it and add components from GitHub.
Make sure the "@/..." import alias points at src/.
