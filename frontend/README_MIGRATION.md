
# Frameline Studio Frontend (Next.js)

This is a migration of the `Decopaj-pro` React app to Next.js 16.

## Setup

1.  Created a `.env.local` file in this directory.
2.  Add your Gemini API Key:
    ```env
    NEXT_PUBLIC_GEMINI_API_KEY=your_api_key_here
    ```

## Running the app

```bash
npm run dev
```

## Migration Notes
- All logic has been preserved in `components/MainApp.tsx`.
- Types are in `types.ts`.
- Services are in `services/geminiService.ts`.
- Styling from `index.html` has been moved to `app/globals.css`.
- `ShotCard` is in `components/ShotCard.tsx`.
