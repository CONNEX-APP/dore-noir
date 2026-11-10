# Domaine du Doré Noir

Carte hors ligne et livre du chalet du Lac Bouchard (web app installable sur iPhone et iPad).

**Adresse :** https://connex-app.github.io/dore-noir/

## Version 0.1
- Accueil : ajout à l'écran d'accueil, téléchargement de la carte, localisation.
- Carte hors ligne : route Esso de Saint-Michel-des-Saints → fourche du KM 66 → chalet, territoire de chasse, lacs, sentiers, caches, saline.
- Fond de carte OpenFreeMap (OpenStreetMap) mis en cache pour la zone (10 km autour du chalet + 1 km de chaque côté des tracés).
- GPS, flèche « Retour au chalet » (avec boussole), alerte de sortie de zone.
- Guidage depuis l'Esso : position au KM, distance restante, prochain repère, alerte hors route, voix.

## Données
- `data/carte.geojson` : tracés, zone, lacs et points.
- `data/route.json` : route de guidage et repères.
- `data/tiles.json` / `data/zone-hors-ligne.json` : zone téléchargée hors ligne.

Fond de carte © OpenFreeMap, © OpenMapTiles, © contributeurs OpenStreetMap. Moteur de carte : MapLibre GL JS (licence BSD, voir `vendor/maplibre-LICENSE.txt`).
