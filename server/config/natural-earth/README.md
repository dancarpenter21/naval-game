# Natural Earth land mask (110m)

The file `ne_110m_land.geojson` is **Natural Earth** 110m physical land (`ne_110m_land`), distributed in the public domain. See [Natural Earth — Terms of Use](https://www.naturalearthdata.com/about/terms-of-use/).

The server loads it at startup (when present) to reject **surface** movement orders that cross land. Override the path with environment variable `LAND_MASK_GEOJSON`.

To refresh from upstream:

```bash
curl -fsSL -o ne_110m_land.geojson \
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson"
```

Higher-resolution Natural Earth tiers (50m / 10m) can be substituted as larger GeoJSON files if you need a sharper coast.
