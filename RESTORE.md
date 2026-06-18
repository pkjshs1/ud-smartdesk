# Restore source files

This repository stores the full Smart Desk source as a Brotli-compressed, Base64-split bundle under `source-parts/`.

To restore the original project files, run:

```bash
node restore-source.js
```

The script creates:

- `restored-source/Code.gs`
- `restored-source/index.html`
- `restored-source/lite.html`

These files include the PIN gate update. The PIN is `dndehd0025`.
