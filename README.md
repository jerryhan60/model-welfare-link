# Study entry link

Public static entry page for the companion study. It reads the current HTTPS
destination from `route.json` on the `live` branch and preserves the visitor's
invitation when redirecting. It contains no study records, API credentials,
researcher keys, or invitation codes.

The Mac mini updates the live branch when its free tunnel address changes.
The fixed entry page does not need rebuilding for those updates. The Mac and
tunnel must still be available; this is a stable entry link, not an uptime guarantee.
