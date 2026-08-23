# Tidyline Admin v4

- Improved phone/tablet responsive layout and touch targets.
- Modals now scroll within the viewport, lock page scrolling, close on backdrop/Escape, and avoid overlap on small screens.
- Sidebar has independent vertical scrolling and mobile drawer behavior.
- Individual audit deletion has an RPC fallback.
- Added consolidated RPC alignment migration `009_admin_rpc_alignment.sql`.
- Clear audit and Fresh Start now have safer fallbacks.
- Customer and payroll tables remain horizontally touch-scrollable rather than overflowing the viewport.
- Customer-facing `index.html` remains frozen and unchanged.
