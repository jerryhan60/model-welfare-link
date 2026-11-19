# Companion study web interface

The participant interface stays at the permanent GitHub Pages address. It reads
the current API destination from `route.json` on the `live` branch. The Mac mini
updates that branch after tunnel changes. Session tokens remain in tab-local
sessionStorage on the stable Pages origin. Failed reads reconnect; actions are
never automatically replayed. The server and study data remain on the Mac mini.

Only public browser assets are stored here. No API credentials, researcher keys,
invitation codes, or participant records are committed. The Mac must stay available;
tunnel rotation can still cause a temporary connection pause.

The source participant assets are maintained in the private model-welfare
repository under companion-prototype/static and copied here for publication.
